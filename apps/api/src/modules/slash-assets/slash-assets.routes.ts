import fs from "fs";
import type express from "express";
import {
  AuditAction,
  ProductionAssetReviewAction,
  ProductionAssetReviewStatus,
  ProductionAssetScope,
  ProductionStage
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import {
  ensureProjectMemberStrict,
  resolveMediaStream,
  serializeAsset,
  serializeSnapshot,
  writeProductionEvent
} from "../production-assets/production-assets.shared";

const upstreamStageByFromStage: Partial<Record<ProductionStage, ProductionStage>> = {
  DIRECTOR_02: ProductionStage.SCRIPT_01,
  ART_03: ProductionStage.SCRIPT_01,
  SHOT_04: ProductionStage.ART_03,
  EDIT_05: ProductionStage.SHOT_04
};

const defaultInsertModeByFromStage: Partial<Record<ProductionStage, string>> = {
  DIRECTOR_02: "TEXT_CONTENT",
  ART_03: "TEXT_CONTENT",
  SHOT_04: "ATTACHMENT_REFERENCE",
  EDIT_05: "IMPORT_TO_EDIT_BIN"
};

const listSchema = z.object({
  fromStage: z.nativeEnum(ProductionStage),
  query: z.string().trim().max(120).optional()
});

const resolveSchema = z.object({
  fromStage: z.nativeEnum(ProductionStage),
  sourceStage: z.nativeEnum(ProductionStage).optional(),
  assetId: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  rowNumber: z.coerce.number().int().positive().optional().nullable(),
  field: z.enum(["storyboardImage", "storyboardVideo", "storyboardImagePrompt", "storyboardVideoPrompt"]).optional().nullable(),
  insertMode: z.enum(["TEXT_CONTENT", "ATTACHMENT_REFERENCE", "IMPORT_TO_EDIT_BIN"]).optional()
});

const assetInclude = {
  project: true,
  creator: { select: { id: true, displayName: true, email: true, username: true } },
  submitter: { select: { id: true, displayName: true, email: true, username: true } },
  reviewer: { select: { id: true, displayName: true, email: true, username: true } }
};

const snapshotInclude = {
  asset: { include: assetInclude },
  createdBy: { select: { id: true, displayName: true, email: true, username: true } },
  reviewedBy: { select: { id: true, displayName: true, email: true, username: true } }
};

function searchFilter(query?: string) {
  if (!query) return undefined;
  return [
    { displayName: { contains: query, mode: "insensitive" as const } },
    { originalName: { contains: query, mode: "insensitive" as const } },
    { description: { contains: query, mode: "insensitive" as const } }
  ];
}

function upstreamStageFor(fromStage: ProductionStage) {
  return upstreamStageByFromStage[fromStage] || null;
}

function normalizeRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.scriptRows)) return payload.scriptRows;
  if (Array.isArray(payload?.breakdownRows)) return payload.breakdownRows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  return [];
}

function rowNumberFor(row: any, index: number) {
  const raw = row?.rowNumber ?? row?.orderIndex ?? row?.order ?? row?.index ?? row?.sequence ?? index + 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1;
}

function readRowField(row: any, field?: string | null) {
  if (!field) return null;
  if (field === "storyboardImage") return row?.storyboardImage ?? row?.storyboardImagePrompt ?? row?.imagePrompt ?? null;
  if (field === "storyboardVideo") return row?.storyboardVideo ?? row?.storyboardVideoPrompt ?? row?.videoPrompt ?? null;
  return row?.[field] ?? null;
}

function textFromPayload(payload: any) {
  if (typeof payload === "string") return payload;
  const candidates = [
    payload?.text,
    payload?.content,
    payload?.prompt,
    payload?.body,
    payload?.output,
    payload?.directorPrompt,
    payload?.value
  ];
  const found = candidates.find((item) => typeof item === "string" && item.trim());
  if (found) return found;
  if (payload && typeof payload === "object") return JSON.stringify(payload, null, 2);
  return "";
}

async function resolveSnapshot(asset: any, snapshotId?: string | null) {
  const id = snapshotId || asset.currentSnapshotId || (asset.sourceType === "review_snapshot" ? asset.sourceId : null);
  if (!id) return null;
  const snapshot = await prisma.productionAssetSnapshot.findUnique({ where: { id }, include: snapshotInclude });
  if (!snapshot || snapshot.asset.projectId !== asset.projectId) throw new HttpError(404, "资产快照不存在。", "SNAPSHOT_NOT_FOUND");
  if (snapshot.assetId !== asset.id && asset.sourceId !== snapshot.id) throw new HttpError(404, "资产快照不存在。", "SNAPSHOT_NOT_FOUND");
  return snapshot;
}

async function readTextAssetContent(asset: any, user: any, snapshot: any | null) {
  const payloadText = textFromPayload(snapshot?.frozenPayload ?? asset.sourcePayload ?? asset.metadata);
  if (payloadText) return payloadText;
  if (!asset.mediaAssetId && !snapshot?.mediaAssetId) return "";
  const stream = await resolveMediaStream(asset, user, snapshot?.id || null);
  if (stream.type !== "file") return "";
  const stat = fs.statSync(stream.path);
  if (stat.size > 1024 * 1024) throw new HttpError(413, "文本资产过大，无法直接插入。", "SLASH_TEXT_ASSET_TOO_LARGE");
  return fs.readFileSync(stream.path, "utf8");
}

async function findCallableAsset(projectId: string, assetId: string, fromStage: ProductionStage, sourceStage?: ProductionStage | null) {
  const expectedSourceStage = upstreamStageFor(fromStage);
  if (!expectedSourceStage) throw new HttpError(400, "当前阶段不支持调用上游团队资产。", "SLASH_STAGE_NOT_SUPPORTED");
  if (sourceStage && sourceStage !== expectedSourceStage) throw new HttpError(400, "调用阶段关系不合法。", "SLASH_STAGE_MISMATCH");
  const asset = await prisma.productionAsset.findFirst({
    where: {
      id: assetId,
      projectId,
      stage: expectedSourceStage,
      scope: ProductionAssetScope.TEAM,
      reviewStatus: ProductionAssetReviewStatus.APPROVED,
      deletedAt: null,
      archivedAt: null
    },
    include: assetInclude
  });
  if (!asset) throw new HttpError(404, "可调用团队资产不存在或无权访问。", "SLASH_ASSET_NOT_FOUND");
  return asset;
}

async function listSlashAssets(req: express.Request, res: express.Response, projectId: string) {
  const user = await requireAuth(req);
  const query = listSchema.parse(req.query || {});
  await ensureProjectMemberStrict(projectId, user);
  const sourceStage = upstreamStageFor(query.fromStage);
  if (!sourceStage) {
    res.json({ success: true, fromStage: query.fromStage, sourceStage: null, assets: [] });
    return;
  }
  const assets = await prisma.productionAsset.findMany({
    where: {
      projectId,
      stage: sourceStage,
      scope: ProductionAssetScope.TEAM,
      reviewStatus: ProductionAssetReviewStatus.APPROVED,
      deletedAt: null,
      archivedAt: null,
      ...(query.query ? { OR: searchFilter(query.query) } : {})
    },
    include: assetInclude,
    orderBy: { updatedAt: "desc" },
    take: 50
  });
  res.json({
    success: true,
    fromStage: query.fromStage,
    sourceStage,
    insertMode: defaultInsertModeByFromStage[query.fromStage] || null,
    assets: assets.map(serializeAsset)
  });
}

async function listScriptRows(req: express.Request, res: express.Response, projectId: string, assetId: string) {
  const user = await requireAuth(req);
  await ensureProjectMemberStrict(projectId, user);
  const asset = await findCallableAsset(projectId, assetId, ProductionStage.DIRECTOR_02, ProductionStage.SCRIPT_01);
  const snapshot = await resolveSnapshot(asset, typeof req.query.snapshotId === "string" ? req.query.snapshotId : null);
  const rows = normalizeRows(snapshot?.frozenPayload ?? asset.sourcePayload);
  res.json({
    success: true,
    asset: serializeAsset(asset),
    snapshot: snapshot ? serializeSnapshot(snapshot) : null,
    rows: rows.map((row, index) => ({
      rowNumber: rowNumberFor(row, index),
      hasStoryboardImage: Boolean(readRowField(row, "storyboardImage")),
      hasStoryboardVideo: Boolean(readRowField(row, "storyboardVideo"))
    }))
  });
}

async function resolveSlashAsset(req: express.Request, res: express.Response, projectId: string) {
  const user = await requireAuth(req);
  const body = resolveSchema.parse(req.body || {});
  await ensureProjectMemberStrict(projectId, user);
  const sourceStage = upstreamStageFor(body.fromStage);
  if (!sourceStage) throw new HttpError(400, "当前阶段不支持调用上游团队资产。", "SLASH_STAGE_NOT_SUPPORTED");
  const asset = await findCallableAsset(projectId, body.assetId, body.fromStage, body.sourceStage || sourceStage);
  const snapshot = await resolveSnapshot(asset, body.snapshotId || null);
  const insertMode = body.insertMode || defaultInsertModeByFromStage[body.fromStage] || "TEXT_CONTENT";
  let resolved: any = {
    fromStage: body.fromStage,
    sourceStage,
    insertMode,
    asset: serializeAsset(asset),
    snapshot: snapshot ? serializeSnapshot(snapshot) : null
  };

  if (body.fromStage === ProductionStage.DIRECTOR_02) {
    const rows = normalizeRows(snapshot?.frozenPayload ?? asset.sourcePayload);
    const rowNumber = body.rowNumber;
    const field = body.field || null;
    if (!rowNumber || !field) throw new HttpError(400, "请选择剧本行序号和输出类型。", "SLASH_SCRIPT_ROW_REQUIRED");
    const row = rows.find((item, index) => rowNumberFor(item, index) === rowNumber);
    if (!row) throw new HttpError(404, "剧本行不存在。", "SLASH_SCRIPT_ROW_NOT_FOUND");
    const content = readRowField(row, field);
    if (!content) throw new HttpError(404, "所选剧本行没有可调用内容。", "SLASH_SCRIPT_FIELD_EMPTY");
    resolved = { ...resolved, rowNumber, field, content: String(content), reference: { assetId: asset.id, snapshotId: snapshot?.id || null, rowNumber, field } };
  } else if (body.fromStage === ProductionStage.ART_03) {
    const content = await readTextAssetContent(asset, user, snapshot);
    if (!content) throw new HttpError(404, "所选文本资产没有可调用内容。", "SLASH_TEXT_CONTENT_EMPTY");
    resolved = { ...resolved, content, reference: { assetId: asset.id, snapshotId: snapshot?.id || null } };
  } else {
    resolved = {
      ...resolved,
      reference: {
        assetId: asset.id,
        snapshotId: snapshot?.id || null,
        mediaAssetId: snapshot?.mediaAssetId || asset.mediaAssetId || null,
        streamUrl: snapshot?.mediaAssetId || asset.mediaAssetId ? `/api/production-assets/${asset.id}/stream${snapshot?.id ? `?snapshotId=${encodeURIComponent(snapshot.id)}` : ""}` : null
      }
    };
  }

  await writeProductionEvent({
    assetId: asset.id,
    snapshotId: snapshot?.id || null,
    actor: user,
    action: ProductionAssetReviewAction.CREATE,
    metadata: {
      operation: "slash_resolve",
      projectId,
      fromStage: body.fromStage,
      sourceStage,
      insertMode,
      rowNumber: body.rowNumber || null,
      field: body.field || null
    }
  });
  await writeAuditLog({
    actor: user,
    action: AuditAction.ACCESS,
    entityType: "ProductionAsset",
    entityId: asset.id,
    req,
    metadata: {
      operation: "slash_resolve",
      projectId,
      fromStage: body.fromStage,
      sourceStage,
      insertMode,
      snapshotId: snapshot?.id || null,
      rowNumber: body.rowNumber || null,
      field: body.field || null
    }
  });
  res.json({ success: true, resolved });
}

export function registerSlashAssetRoutes(app: express.Express) {
  for (const prefix of ["/api/team-projects", "/api/projects"]) {
    app.get(`${prefix}/:projectId/slash-assets`, async (req, res) => {
      try {
        await listSlashAssets(req, res, req.params.projectId);
      } catch (error) {
        sendApiError(res, error, "Slash 团队资产列表读取失败。");
      }
    });

    app.get(`${prefix}/:projectId/slash-assets/:assetId/script-rows`, async (req, res) => {
      try {
        await listScriptRows(req, res, req.params.projectId, req.params.assetId);
      } catch (error) {
        sendApiError(res, error, "剧本资产行读取失败。");
      }
    });

    app.post(`${prefix}/:projectId/slash-assets/resolve`, async (req, res) => {
      try {
        await resolveSlashAsset(req, res, req.params.projectId);
      } catch (error) {
        sendApiError(res, error, "Slash 团队资产解析失败。");
      }
    });
  }
}
