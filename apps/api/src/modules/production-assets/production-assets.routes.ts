import fs from "fs";
import type express from "express";
import {
  AuditAction,
  MediaAssetType,
  NotificationType,
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
  assertAssetReadable,
  assertMediaAssetUsableForProductionAsset,
  buildInternalDisplayName,
  ensureProjectMember,
  ensureProjectMemberStrict,
  isGlobalReviewer,
  mediaTypeFromMime,
  notifyUsers,
  resolveMediaStream,
  reviewerIdsForProject,
  serializeAsset,
  serializeSnapshot,
  STAGE_LABEL,
  systemDisplayName,
  writeProductionEvent
} from "./production-assets.shared";

const stageSchema = z.nativeEnum(ProductionStage);

const createAssetSchema = z.object({
  projectId: z.string().min(1),
  stage: stageSchema,
  originalName: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  mediaAssetId: z.string().min(1).optional(),
  mimeType: z.string().trim().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sourceType: z.string().trim().max(80).optional(),
  sourceId: z.string().trim().max(160).optional(),
  sourcePayload: z.any().optional(),
  metadata: z.any().optional()
});

const listAssetSchema = z.object({
  projectId: z.string().optional(),
  stage: stageSchema.optional(),
  query: z.string().trim().max(120).optional()
});

const libraryAssetSchema = listAssetSchema.extend({
  type: z.enum(["all", "image", "video", "audio", "document"]).optional()
});

const submitReviewSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  frozenPayload: z.any().optional()
});

function textFilter(query?: string) {
  if (!query) return undefined;
  return [
    { originalName: { contains: query, mode: "insensitive" as const } },
    { displayName: { contains: query, mode: "insensitive" as const } },
    { description: { contains: query, mode: "insensitive" as const } }
  ];
}

const assetInclude = {
  project: true,
  creator: { select: { id: true, displayName: true, email: true, username: true } },
  submitter: { select: { id: true, displayName: true, email: true, username: true } },
  reviewer: { select: { id: true, displayName: true, email: true, username: true } }
};

export function registerProductionAssetRoutes(app: express.Express) {
  app.post("/api/production-assets", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = createAssetSchema.parse(req.body || {});
      await ensureProjectMember(body.projectId, user);
      const media = body.mediaAssetId ? await prisma.mediaAsset.findUnique({ where: { id: body.mediaAssetId } }) : null;
      if (body.mediaAssetId && !media) throw new HttpError(404, "关联媒体不存在。", "MEDIA_NOT_FOUND");
      if (media) await assertMediaAssetUsableForProductionAsset(media, user);
      const asset = await prisma.productionAsset.create({
        data: {
          projectId: body.projectId,
          stage: body.stage,
          scope: ProductionAssetScope.PERSONAL,
          reviewStatus: ProductionAssetReviewStatus.UNREVIEWED,
          creatorId: user.id,
          originalName: body.originalName,
          displayName: body.originalName,
          description: body.description || null,
          mediaAssetId: body.mediaAssetId || null,
          mimeType: body.mimeType || media?.mimeType || null,
          sizeBytes: body.sizeBytes ?? media?.sizeBytes ?? null,
          sourceType: body.sourceType || null,
          sourceId: body.sourceId || null,
          sourcePayload: body.sourcePayload,
          metadata: body.metadata
        },
        include: assetInclude
      });
      await writeProductionEvent({ assetId: asset.id, actor: user, action: ProductionAssetReviewAction.CREATE });
      await writeAuditLog({ actor: user, action: AuditAction.CREATE, entityType: "ProductionAsset", entityId: asset.id, req, metadata: { stage: asset.stage, projectId: asset.projectId } });
      res.status(201).json({ success: true, asset: serializeAsset(asset) });
    } catch (error) {
      sendApiError(res, error, "生产资产创建失败。");
    }
  });

  app.get("/api/production-assets/personal", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const query = listAssetSchema.parse(req.query || {});
      const assets = await prisma.productionAsset.findMany({
        where: {
          scope: ProductionAssetScope.PERSONAL,
          creatorId: user.id,
          deletedAt: null,
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.stage ? { stage: query.stage } : {}),
          ...(query.query ? { OR: textFilter(query.query) } : {})
        },
        orderBy: { updatedAt: "desc" },
        include: assetInclude,
        take: 100
      });
      res.json({ success: true, assets: assets.map(serializeAsset) });
    } catch (error) {
      sendApiError(res, error, "个人资产列表读取失败。");
    }
  });

  app.get("/api/production-assets/team", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const query = listAssetSchema.extend({ projectId: z.string().min(1) }).parse(req.query || {});
      await ensureProjectMemberStrict(query.projectId, user);
      const assets = await prisma.productionAsset.findMany({
        where: {
          projectId: query.projectId,
          scope: ProductionAssetScope.TEAM,
          reviewStatus: ProductionAssetReviewStatus.APPROVED,
          deletedAt: null,
          archivedAt: null,
          ...(query.stage ? { stage: query.stage } : {}),
          ...(query.query ? { OR: textFilter(query.query) } : {})
        },
        orderBy: { updatedAt: "desc" },
        include: assetInclude,
        take: 100
      });
      res.json({ success: true, assets: assets.map(serializeAsset) });
    } catch (error) {
      sendApiError(res, error, "团队资产列表读取失败。");
    }
  });

  app.get("/api/production-assets/team-library", async (req, res) => {
    try {
      const user = await requireAuth(req);
      if (!isGlobalReviewer(user)) throw new HttpError(403, "Forbidden.", "GLOBAL_DEVELOPER_REQUIRED");
      const query = libraryAssetSchema.parse(req.query || {});
      const mimeTypeFilter = query.type && query.type !== "all"
        ? query.type === "document"
          ? {
              AND: [
                { OR: [{ mimeType: null }, { mimeType: { not: { startsWith: "image/" } } }] },
                { OR: [{ mimeType: null }, { mimeType: { not: { startsWith: "video/" } } }] },
                { OR: [{ mimeType: null }, { mimeType: { not: { startsWith: "audio/" } } }] }
              ]
            }
          : { mimeType: { startsWith: `${query.type}/` } }
        : {};
      const assets = await prisma.productionAsset.findMany({
        where: {
          scope: ProductionAssetScope.TEAM,
          reviewStatus: ProductionAssetReviewStatus.APPROVED,
          deletedAt: null,
          archivedAt: null,
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.stage ? { stage: query.stage } : {}),
          ...(query.query ? { OR: textFilter(query.query) } : {}),
          ...mimeTypeFilter
        },
        orderBy: { updatedAt: "desc" },
        include: assetInclude,
        take: 200
      });
      res.json({ success: true, assets: assets.map(serializeAsset) });
    } catch (error) {
      sendApiError(res, error, "团队素材库读取失败。");
    }
  });

  app.post("/api/production-assets/:id/submit-review", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = submitReviewSchema.parse(req.body || {});
      const asset = await prisma.productionAsset.findUnique({ where: { id: req.params.id }, include: { mediaAsset: true } });
      if (!asset || asset.deletedAt || asset.scope !== ProductionAssetScope.PERSONAL || asset.creatorId !== user.id) {
        throw new HttpError(404, "资产不存在或无权提交审核。", "ASSET_NOT_FOUND");
      }
      if (asset.reviewStatus === ProductionAssetReviewStatus.IN_REVIEW) {
        throw new HttpError(409, "资产已经在审核中。", "ASSET_ALREADY_IN_REVIEW");
      }
      if (!asset.projectId) throw new HttpError(400, "资产缺少所属项目。", "ASSET_PROJECT_REQUIRED");
      await ensureProjectMember(asset.projectId, user);
      const displayName = await buildInternalDisplayName({ submitterId: user.id, stage: asset.stage, originalName: asset.originalName });
      const nextVersion = asset.version + 1;
      const updated = await prisma.$transaction(async (tx) => {
        const snapshot = await tx.productionAssetSnapshot.create({
          data: {
            assetId: asset.id,
            version: nextVersion,
            reviewStatus: ProductionAssetReviewStatus.IN_REVIEW,
            createdById: user.id,
            mediaAssetId: asset.mediaAssetId,
            originalName: asset.originalName,
            displayName,
            frozenPayload: body.frozenPayload ?? asset.sourcePayload ?? asset.metadata ?? {},
            frozenStorageObjectKey: asset.mediaAsset?.storageKey || asset.mediaAsset?.fileKey || null,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            reviewNote: body.note || null
          }
        });
        const nextAsset = await tx.productionAsset.update({
          where: { id: asset.id },
          data: {
            reviewStatus: ProductionAssetReviewStatus.IN_REVIEW,
            submitterId: user.id,
            displayName,
            version: nextVersion,
            currentSnapshotId: snapshot.id
          },
          include: assetInclude
        });
        await tx.productionAssetReviewEvent.create({
          data: {
            assetId: asset.id,
            snapshotId: snapshot.id,
            actorId: user.id,
            action: ProductionAssetReviewAction.SUBMIT_REVIEW,
            note: body.note || null
          }
        });
        return { asset: nextAsset, snapshot };
      });
      const reviewers = await reviewerIdsForProject(asset.projectId);
      const [submitterName, project] = await Promise.all([
        systemDisplayName(user.id),
        prisma.productionProject.findUnique({ where: { id: asset.projectId }, select: { name: true } })
      ]);
      await notifyUsers({
        receiverIds: reviewers.filter((id) => id !== user.id),
        type: NotificationType.ASSET_SUBMITTED,
        title: "新的文件提交审核",
        content: [
          `${submitterName} 提交了文件「${updated.asset.displayName}」。`,
          `项目：${project?.name || "未知项目"}`,
          `阶段：${STAGE_LABEL[asset.stage]}`,
          `提交时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
        ].join("\n"),
        targetType: "ProductionAssetSnapshot",
        targetId: updated.snapshot.id,
        projectId: asset.projectId,
        metadata: {
          action: "submit_review",
          assetId: asset.id,
          snapshotId: updated.snapshot.id,
          submitterId: user.id,
          submitterName,
          stage: asset.stage
        }
      });
      await writeAuditLog({ actor: user, action: AuditAction.CREATE, entityType: "ProductionAssetReview", entityId: updated.snapshot.id, req, metadata: { operation: "submit_review", assetId: asset.id, projectId: asset.projectId, stage: asset.stage } });
      res.status(201).json({ success: true, asset: serializeAsset(updated.asset), snapshot: serializeSnapshot(updated.snapshot) });
    } catch (error) {
      sendApiError(res, error, "提交审核失败。");
    }
  });

  app.delete("/api/production-assets/:id", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const asset = await prisma.productionAsset.findUnique({ where: { id: req.params.id } });
      if (!asset || asset.deletedAt) throw new HttpError(404, "资产不存在。", "ASSET_NOT_FOUND");
      if (asset.scope !== ProductionAssetScope.PERSONAL) {
        throw new HttpError(403, "团队资产和内部素材只能通过审核管理流程处理。", "ASSET_DELETE_SCOPE_FORBIDDEN");
      }
      if (asset.creatorId !== user.id) {
        throw new HttpError(403, "Forbidden.", "ASSET_DELETE_FORBIDDEN");
      }
      if (asset.reviewStatus === ProductionAssetReviewStatus.IN_REVIEW) {
        throw new HttpError(409, "资产正在审核中，不能删除。请等待审核完成或由审核员处理。", "ASSET_IN_REVIEW_DELETE_FORBIDDEN");
      }
      if (asset.reviewStatus !== ProductionAssetReviewStatus.UNREVIEWED && asset.reviewStatus !== ProductionAssetReviewStatus.REJECTED) {
        throw new HttpError(409, "只有未审核或审核未通过的个人资产可以删除。", "ASSET_DELETE_STATUS_FORBIDDEN");
      }
      const updated = await prisma.productionAsset.update({
        where: { id: asset.id },
        data: { deletedAt: new Date() },
        include: assetInclude
      });
      await writeProductionEvent({ assetId: asset.id, actor: user, action: ProductionAssetReviewAction.SOFT_DELETE });
      await writeAuditLog({ actor: user, action: AuditAction.DELETE, entityType: "ProductionAsset", entityId: asset.id, req, beforeJson: { reviewStatus: asset.reviewStatus, scope: asset.scope } });
      res.json({ success: true, asset: serializeAsset(updated) });
    } catch (error) {
      sendApiError(res, error, "资产删除失败。");
    }
  });

  app.get("/api/production-assets/:id/snapshots/:snapshotId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const snapshot = await prisma.productionAssetSnapshot.findUnique({
        where: { id: req.params.snapshotId },
        include: {
          asset: { include: assetInclude },
          createdBy: { select: { id: true, displayName: true, email: true, username: true } },
          reviewedBy: { select: { id: true, displayName: true, email: true, username: true } }
        }
      });
      if (!snapshot || snapshot.assetId !== req.params.id) throw new HttpError(404, "资产快照不存在。", "SNAPSHOT_NOT_FOUND");
      await assertAssetReadable(snapshot.asset, user);
      res.json({ success: true, snapshot: serializeSnapshot(snapshot) });
    } catch (error) {
      sendApiError(res, error, "资产快照读取失败。");
    }
  });

  app.get("/api/production-assets/:id/stream", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const asset = await prisma.productionAsset.findUnique({ where: { id: req.params.id } });
      if (!asset || asset.deletedAt) throw new HttpError(404, "资产不存在。", "ASSET_NOT_FOUND");
      await assertAssetReadable(asset, user);
      const stream = await resolveMediaStream(asset, user, typeof req.query.snapshotId === "string" ? req.query.snapshotId : null);
      if (stream.type === "redirect") {
        res.redirect(stream.url);
        return;
      }
      const stat = fs.statSync(stream.path);
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": stream.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
      });
      fs.createReadStream(stream.path).pipe(res);
    } catch (error) {
      sendApiError(res, error, "资产预览失败。");
    }
  });

  app.get("/api/production-assets/meta/stages", (_req, res) => {
    res.json({ success: true, stages: Object.values(ProductionStage), scopes: Object.values(ProductionAssetScope), reviewStatuses: Object.values(ProductionAssetReviewStatus), mediaTypes: Object.values(MediaAssetType), mediaTypeFromMime: Boolean(mediaTypeFromMime) });
  });
}
