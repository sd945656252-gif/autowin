import fs from "fs";
import type express from "express";
import {
  AuditAction,
  MediaVisibility,
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
import { recordLocalMediaAsset } from "../media/media.service";
import { createLocalUpload, effectiveUploadMime, hasValidMagicNumber } from "../media/media.upload";
import {
  ensureReviewerForProject,
  mediaTypeFromMime,
  notifyUsers,
  reviewerProjectScope,
  serializeAsset,
  serializeInternalAssetItem,
  serializeSnapshot,
  writeProductionEvent
} from "../production-assets/production-assets.shared";

const referenceUpload = createLocalUpload(Number(process.env.REFERENCE_ASSET_UPLOAD_MAX_MB || 100));

const listInternalSchema = z.object({
  projectId: z.string().optional(),
  reviewStatus: z.nativeEnum(ProductionAssetReviewStatus).optional(),
  mediaType: z.enum(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]).optional(),
  stage: z.nativeEnum(ProductionStage).optional(),
  search: z.string().trim().max(120).optional()
});

const reviewBodySchema = z.object({
  note: z.string().trim().max(1000).optional()
});

const referenceBodySchema = z.object({
  projectId: z.string().optional(),
  stage: z.nativeEnum(ProductionStage).default(ProductionStage.SCRIPT_01),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1000).optional(),
  visibleUserIds: z.union([z.string(), z.array(z.string())]).optional()
});

function uploadSingle(fieldName: string): express.RequestHandler {
  const middleware = referenceUpload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (error: any) => {
      if (error) {
        res.status(400).json({ success: false, error: error.message || "参考素材上传失败。" });
        return;
      }
      next();
    });
  };
}

function deleteUploadedFile(file?: Express.Multer.File) {
  if (!file?.path) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch (error) {
    console.warn("[ReferenceAssetUpload] Failed to remove rejected upload:", error);
  }
}

function parseVisibleUsers(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // fall through to comma-separated parsing
    }
    return trimmed.split(/[,，]/g).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function internalSearch(search?: string) {
  if (!search) return undefined;
  return [
    { displayName: { contains: search, mode: "insensitive" as const } },
    { originalName: { contains: search, mode: "insensitive" as const } },
    { description: { contains: search, mode: "insensitive" as const } },
    { project: { name: { contains: search, mode: "insensitive" as const } } },
    { creator: { displayName: { contains: search, mode: "insensitive" as const } } },
    { submitter: { displayName: { contains: search, mode: "insensitive" as const } } }
  ];
}

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

export function registerInternalAssetRoutes(app: express.Express) {
  app.get("/api/internal-assets", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const query = listInternalSchema.parse(req.query || {});
      const allowedProjectIds = await reviewerProjectScope(user);
      if (query.projectId) await ensureReviewerForProject(query.projectId, user);
      const projectFilter = query.projectId
        ? { projectId: query.projectId }
        : allowedProjectIds
          ? { projectId: { in: allowedProjectIds } }
          : {};
      const snapshots = await prisma.productionAssetSnapshot.findMany({
        where: {
          ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
          asset: {
            deletedAt: null,
            ...projectFilter,
            ...(query.stage ? { stage: query.stage } : {}),
            ...(query.mediaType ? { mediaAsset: { type: query.mediaType } } : {}),
            ...(query.search ? { OR: internalSearch(query.search) } : {})
          }
        },
        orderBy: { createdAt: "desc" },
        include: snapshotInclude,
        take: 200
      });
      const referenceAssets = query.reviewStatus && query.reviewStatus !== ProductionAssetReviewStatus.REFERENCE
        ? []
        : await prisma.productionAsset.findMany({
            where: {
              scope: ProductionAssetScope.INTERNAL,
              reviewStatus: ProductionAssetReviewStatus.REFERENCE,
              deletedAt: null,
              ...projectFilter,
              ...(query.stage ? { stage: query.stage } : {}),
              ...(query.mediaType ? { mediaAsset: { type: query.mediaType } } : {}),
              ...(query.search ? { OR: internalSearch(query.search) } : {})
            },
            orderBy: { createdAt: "desc" },
            include: assetInclude,
            take: 200
          });
      const items = [
        ...snapshots.map((snapshot) => ({ kind: "snapshot" as const, snapshot })),
        ...referenceAssets.map((asset) => ({ kind: "reference" as const, asset }))
      ]
        .sort((left, right) => {
          const leftTime = (left.kind === "snapshot" ? left.snapshot.createdAt : left.asset.createdAt).getTime();
          const rightTime = (right.kind === "snapshot" ? right.snapshot.createdAt : right.asset.createdAt).getTime();
          return rightTime - leftTime;
        })
        .slice(0, 200);
      res.json({
        success: true,
        items: items.map(serializeInternalAssetItem),
        snapshots: snapshots.map(serializeSnapshot),
        referenceAssets: referenceAssets.map(serializeAsset)
      });
    } catch (error) {
      sendApiError(res, error, "内部素材库读取失败。");
    }
  });

  app.post("/api/internal-assets/:snapshotId/approve", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = reviewBodySchema.parse(req.body || {});
      const snapshot = await prisma.productionAssetSnapshot.findUnique({ where: { id: req.params.snapshotId }, include: { asset: true } });
      if (!snapshot || snapshot.asset.deletedAt) throw new HttpError(404, "审核快照不存在。", "SNAPSHOT_NOT_FOUND");
      await ensureReviewerForProject(snapshot.asset.projectId, user);
      if (snapshot.reviewStatus !== ProductionAssetReviewStatus.IN_REVIEW) throw new HttpError(409, "只能审核待审核快照。", "SNAPSHOT_NOT_IN_REVIEW");
      if (snapshot.asset.currentSnapshotId !== snapshot.id || snapshot.asset.reviewStatus !== ProductionAssetReviewStatus.IN_REVIEW) {
        throw new HttpError(409, "该审核快照不是资产当前待审版本。", "STALE_REVIEW_SNAPSHOT");
      }
      const result = await prisma.$transaction(async (tx) => {
        const reviewedAt = new Date();
        const approvedSnapshot = await tx.productionAssetSnapshot.update({
          where: { id: snapshot.id },
          data: { reviewStatus: ProductionAssetReviewStatus.APPROVED, reviewedById: user.id, reviewedAt, reviewNote: body.note || null }
        });
        const personalAsset = await tx.productionAsset.update({
          where: { id: snapshot.assetId },
          data: { reviewStatus: ProductionAssetReviewStatus.APPROVED, reviewerId: user.id },
          include: assetInclude
        });
        const supersededTeamAssets = await tx.productionAsset.findMany({
          where: {
            projectId: snapshot.asset.projectId,
            stage: snapshot.asset.stage,
            scope: ProductionAssetScope.TEAM,
            reviewStatus: ProductionAssetReviewStatus.APPROVED,
            archivedAt: null,
            deletedAt: null,
            metadata: { path: ["personalAssetId"], equals: snapshot.assetId }
          },
          select: { id: true, currentSnapshotId: true }
        });
        if (supersededTeamAssets.length > 0) {
          await tx.productionAsset.updateMany({
            where: { id: { in: supersededTeamAssets.map((asset) => asset.id) } },
            data: { reviewStatus: ProductionAssetReviewStatus.ARCHIVED, archivedAt: reviewedAt, reviewerId: user.id }
          });
        }
        const teamAsset = await tx.productionAsset.create({
          data: {
            projectId: snapshot.asset.projectId,
            stage: snapshot.asset.stage,
            scope: ProductionAssetScope.TEAM,
            reviewStatus: ProductionAssetReviewStatus.APPROVED,
            creatorId: snapshot.asset.creatorId,
            submitterId: snapshot.asset.submitterId,
            reviewerId: user.id,
            mediaAssetId: snapshot.mediaAssetId || snapshot.asset.mediaAssetId,
            originalName: snapshot.originalName,
            displayName: snapshot.displayName,
            description: snapshot.asset.description,
            mimeType: snapshot.mimeType,
            sizeBytes: snapshot.sizeBytes,
            version: snapshot.version,
            currentSnapshotId: snapshot.id,
            sourceType: "review_snapshot",
            sourceId: snapshot.id,
            sourcePayload: snapshot.frozenPayload,
            metadata: { personalAssetId: snapshot.assetId }
          },
          include: assetInclude
        });
        await tx.productionAssetReviewEvent.createMany({
          data: [
            { assetId: snapshot.assetId, snapshotId: snapshot.id, actorId: user.id, action: ProductionAssetReviewAction.APPROVE, note: body.note || null },
            { assetId: teamAsset.id, snapshotId: snapshot.id, actorId: user.id, action: ProductionAssetReviewAction.APPROVE, note: "team_asset_created" },
            ...supersededTeamAssets.map((asset) => ({
              assetId: asset.id,
              snapshotId: asset.currentSnapshotId,
              actorId: user.id,
              action: ProductionAssetReviewAction.ARCHIVE,
              note: "superseded_by_new_approved_version"
            }))
          ]
        });
        return { snapshot: approvedSnapshot, personalAsset, teamAsset };
      });
      if (snapshot.asset.submitterId) {
        await notifyUsers({
          receiverIds: [snapshot.asset.submitterId],
          type: NotificationType.ASSET_APPROVED,
          title: "资产审核通过",
          content: snapshot.displayName,
          targetType: "ProductionAsset",
          targetId: snapshot.assetId,
          projectId: snapshot.asset.projectId
        });
      }
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionAssetReview", entityId: snapshot.id, req, metadata: { operation: "approve", assetId: snapshot.assetId, teamAssetId: result.teamAsset.id } });
      res.json({ success: true, snapshot: serializeSnapshot({ ...result.snapshot, asset: result.personalAsset }), asset: serializeAsset(result.personalAsset), teamAsset: serializeAsset(result.teamAsset) });
    } catch (error) {
      sendApiError(res, error, "审核通过失败。");
    }
  });

  app.post("/api/internal-assets/:snapshotId/reject", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = reviewBodySchema.parse(req.body || {});
      const snapshot = await prisma.productionAssetSnapshot.findUnique({ where: { id: req.params.snapshotId }, include: { asset: true } });
      if (!snapshot || snapshot.asset.deletedAt) throw new HttpError(404, "审核快照不存在。", "SNAPSHOT_NOT_FOUND");
      await ensureReviewerForProject(snapshot.asset.projectId, user);
      if (snapshot.reviewStatus !== ProductionAssetReviewStatus.IN_REVIEW) throw new HttpError(409, "只能驳回待审核快照。", "SNAPSHOT_NOT_IN_REVIEW");
      if (snapshot.asset.currentSnapshotId !== snapshot.id || snapshot.asset.reviewStatus !== ProductionAssetReviewStatus.IN_REVIEW) {
        throw new HttpError(409, "该审核快照不是资产当前待审版本。", "STALE_REVIEW_SNAPSHOT");
      }
      const result = await prisma.$transaction(async (tx) => {
        const rejectedSnapshot = await tx.productionAssetSnapshot.update({
          where: { id: snapshot.id },
          data: { reviewStatus: ProductionAssetReviewStatus.REJECTED, reviewedById: user.id, reviewedAt: new Date(), reviewNote: body.note || null }
        });
        const asset = await tx.productionAsset.update({
          where: { id: snapshot.assetId },
          data: { reviewStatus: ProductionAssetReviewStatus.REJECTED, reviewerId: user.id },
          include: assetInclude
        });
        await tx.productionAssetReviewEvent.create({
          data: { assetId: snapshot.assetId, snapshotId: snapshot.id, actorId: user.id, action: ProductionAssetReviewAction.REJECT, note: body.note || null }
        });
        return { snapshot: rejectedSnapshot, asset };
      });
      if (snapshot.asset.submitterId) {
        await notifyUsers({
          receiverIds: [snapshot.asset.submitterId],
          type: NotificationType.ASSET_REJECTED,
          title: "资产审核未通过",
          content: snapshot.displayName,
          targetType: "ProductionAsset",
          targetId: snapshot.assetId,
          projectId: snapshot.asset.projectId
        });
      }
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionAssetReview", entityId: snapshot.id, req, metadata: { operation: "reject", assetId: snapshot.assetId } });
      res.json({ success: true, snapshot: serializeSnapshot({ ...result.snapshot, asset: result.asset }), asset: serializeAsset(result.asset) });
    } catch (error) {
      sendApiError(res, error, "审核不通过失败。");
    }
  });

  app.post("/api/internal-assets/:assetId/archive", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = reviewBodySchema.parse(req.body || {});
      const asset = await prisma.productionAsset.findUnique({ where: { id: req.params.assetId }, include: assetInclude });
      if (!asset || asset.deletedAt) throw new HttpError(404, "资产不存在。", "ASSET_NOT_FOUND");
      await ensureReviewerForProject(asset.projectId, user);
      if (asset.reviewStatus === ProductionAssetReviewStatus.ARCHIVED) throw new HttpError(409, "资产已经封存。", "ASSET_ALREADY_ARCHIVED");
      const archived = await prisma.$transaction(async (tx) => {
        const archivedAt = new Date();
        const nextAsset = await tx.productionAsset.update({
          where: { id: asset.id },
          data: { reviewStatus: ProductionAssetReviewStatus.ARCHIVED, archivedAt, reviewerId: user.id },
          include: assetInclude
        });
        const snapshotId = asset.currentSnapshotId || asset.sourceId;
        if (snapshotId) {
          await tx.productionAssetSnapshot.updateMany({
            where: { id: snapshotId },
            data: { reviewStatus: ProductionAssetReviewStatus.ARCHIVED, reviewedById: user.id, reviewedAt: archivedAt, reviewNote: body.note || null }
          });
        }
        return nextAsset;
      });
      await writeProductionEvent({ assetId: asset.id, actor: user, action: ProductionAssetReviewAction.ARCHIVE, note: body.note || null });
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionAsset", entityId: asset.id, req, metadata: { operation: "archive", projectId: asset.projectId, stage: asset.stage } });
      const memberIds = asset.projectId
        ? (await prisma.productionProjectMember.findMany({ where: { projectId: asset.projectId }, select: { userId: true } })).map((member) => member.userId)
        : [];
      await notifyUsers({
        receiverIds: memberIds,
        type: NotificationType.ASSET_ARCHIVED,
        title: "团队资产已封存",
        content: asset.displayName,
        targetType: "ProductionAsset",
        targetId: asset.id,
        projectId: asset.projectId
      });
      res.json({ success: true, asset: serializeAsset(archived) });
    } catch (error) {
      sendApiError(res, error, "资产封存失败。");
    }
  });

  app.post("/api/internal-assets/reference", uploadSingle("file"), async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = referenceBodySchema.parse(req.body || {});
      await ensureReviewerForProject(body.projectId, user);
      if (!req.file) throw new HttpError(400, "请选择参考素材文件。", "REFERENCE_FILE_REQUIRED");
      const effectiveMime = effectiveUploadMime(req.file);
      const header = fs.readFileSync(req.file.path).subarray(0, 4096);
      if (!hasValidMagicNumber(header, effectiveMime)) throw new HttpError(400, "文件内容与声明类型不匹配。", "REFERENCE_FILE_MAGIC_MISMATCH");
      const visibleUserIds = parseVisibleUsers(body.visibleUserIds);
      if (body.projectId && visibleUserIds.length > 0) {
        const memberCount = await prisma.productionProjectMember.count({ where: { projectId: body.projectId, userId: { in: visibleUserIds } } });
        if (memberCount !== visibleUserIds.length) throw new HttpError(403, "参考素材只能分发给当前项目成员。", "REFERENCE_VISIBILITY_PROJECT_MEMBERS_ONLY");
      }
      const media = await recordLocalMediaAsset({
        requestUser: user,
        type: mediaTypeFromMime(effectiveMime),
        url: `/uploads/${req.file.filename}`,
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType: effectiveMime,
        visibility: MediaVisibility.OWNER_ONLY,
        metadata: { purpose: "production-reference-asset" }
      });
      const title = body.title || req.file.originalname || "参考素材";
      const asset = await prisma.productionAsset.create({
        data: {
          projectId: body.projectId || null,
          stage: body.stage,
          scope: ProductionAssetScope.INTERNAL,
          reviewStatus: ProductionAssetReviewStatus.REFERENCE,
          creatorId: user.id,
          submitterId: user.id,
          mediaAssetId: media.id,
          originalName: req.file.originalname || title,
          displayName: title,
          description: body.description || null,
          mimeType: effectiveMime,
          sizeBytes: req.file.size,
          sourceType: "reference_upload",
          metadata: { mediaAssetId: media.id }
        },
        include: assetInclude
      });
      if (visibleUserIds.length > 0) {
        await prisma.productionAssetReferenceVisibility.createMany({
          data: visibleUserIds.map((userId) => ({ assetId: asset.id, userId, assignedById: user.id })),
          skipDuplicates: true
        });
        await notifyUsers({
          receiverIds: visibleUserIds,
          type: NotificationType.REFERENCE_ASSIGNED,
          title: "你收到新的参考素材",
          content: asset.displayName,
          targetType: "ProductionAsset",
          targetId: asset.id,
          projectId: asset.projectId
        });
      }
      await writeProductionEvent({ assetId: asset.id, actor: user, action: ProductionAssetReviewAction.REFERENCE_UPLOAD, metadata: { visibleUserCount: visibleUserIds.length } });
      await writeAuditLog({ actor: user, action: AuditAction.CREATE, entityType: "ProductionReferenceAsset", entityId: asset.id, req, metadata: { projectId: asset.projectId, visibleUserCount: visibleUserIds.length } });
      res.status(201).json({ success: true, asset: serializeAsset(asset) });
    } catch (error) {
      deleteUploadedFile(req.file);
      sendApiError(res, error, "参考素材上传失败。");
    }
  });
}
