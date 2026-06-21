import fs from "fs";
import path from "path";
import {
  MediaVisibility,
  MediaAssetType,
  NotificationType,
  ProductionAssetReviewAction,
  ProductionAssetReviewStatus,
  ProductionAssetScope,
  ProductionProjectGrantRole,
  ProductionProjectMemberRole,
  ProductionStage,
  UserRole
} from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import { getUploadsDir } from "../../shared/storage-paths";
import type { RequestUser } from "../auth/auth.shared";
import { canReadMediaAsset, markMediaAssetAccessed, protectedMediaUrl } from "../media/media.service";

export const STAGE_LABEL: Record<ProductionStage, string> = {
  SCRIPT_01: "01剧本",
  DIRECTOR_02: "历史导演讲戏",
  ART_03: "02美术设计",
  SHOT_04: "03镜头设计",
  EDIT_05: "04剪辑"
};

export function assertAuthed(user: RequestUser) {
  if (user.isGuest) throw new HttpError(401, "Authentication is required.");
}

export function isGlobalReviewer(user: RequestUser) {
  return user.role === UserRole.ADMIN || user.role === UserRole.DEVELOPER;
}

export function dateStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export async function ensureProjectMember(projectId: string, user: RequestUser) {
  assertAuthed(user);
  if (isGlobalReviewer(user)) return true;
  return ensureProjectMemberStrict(projectId, user);
}

export async function ensureProjectMemberStrict(projectId: string, user: RequestUser) {
  assertAuthed(user);
  const member = await prisma.productionProjectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } }
  });
  if (!member) throw new HttpError(404, "项目不存在或无权访问。", "PROJECT_NOT_FOUND");
  return true;
}

export async function ensureProjectOwnerOrGlobal(projectId: string, user: RequestUser) {
  assertAuthed(user);
  if (isGlobalReviewer(user)) return true;
  const member = await prisma.productionProjectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } }
  });
  if (!member || member.role !== ProductionProjectMemberRole.OWNER) {
    throw new HttpError(403, "Forbidden.", "PROJECT_OWNER_REQUIRED");
  }
  return true;
}

export async function ensureProjectManagerOrGlobal(projectId: string, user: RequestUser) {
  assertAuthed(user);
  if (isGlobalReviewer(user)) return true;
  return ensureProjectManager(projectId, user);
}

export async function hasProjectManagerAccess(projectId: string, userId: string) {
  const member = await prisma.productionProjectMember.findUnique({
    where: { projectId_userId: { projectId, userId } }
  });
  if (member?.role === ProductionProjectMemberRole.OWNER) return true;
  if (await hasActiveProjectDeveloperGrant(projectId, userId)) return true;
  return false;
}

export async function ensureProjectManager(projectId: string, user: RequestUser) {
  assertAuthed(user);
  if (await hasProjectManagerAccess(projectId, user.id)) return true;
  throw new HttpError(403, "Forbidden.", "PROJECT_MANAGER_REQUIRED");
}

export async function hasActiveProjectDeveloperGrant(projectId: string, userId: string) {
  const now = new Date();
  const grant = await prisma.productionProjectRoleGrant.findFirst({
    where: {
      projectId,
      userId,
      role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    }
  });
  return Boolean(grant);
}

export async function ensureReviewerForProject(projectId: string | null | undefined, user: RequestUser) {
  assertAuthed(user);
  if (!projectId) throw new HttpError(403, "Forbidden.", "PROJECT_REVIEWER_REQUIRED");
  const member = await prisma.productionProjectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } }
  });
  if (member?.role === ProductionProjectMemberRole.OWNER) return true;
  if (await hasActiveProjectDeveloperGrant(projectId, user.id)) return true;
  throw new HttpError(403, "Forbidden.", "PROJECT_REVIEWER_REQUIRED");
}

export async function reviewerProjectScope(user: RequestUser) {
  assertAuthed(user);
  const [ownedMemberships, grants] = await Promise.all([
    prisma.productionProjectMember.findMany({
      where: { userId: user.id, role: ProductionProjectMemberRole.OWNER },
      select: { projectId: true }
    }),
    prisma.productionProjectRoleGrant.findMany({
      where: {
        userId: user.id,
        role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      select: { projectId: true }
    })
  ]);
  const projectIds = Array.from(new Set([...ownedMemberships.map((member) => member.projectId), ...grants.map((grant) => grant.projectId)]));
  if (projectIds.length === 0) throw new HttpError(403, "Forbidden.", "REVIEWER_REQUIRED");
  return projectIds;
}

export async function notifyUsers(input: {
  receiverIds: string[];
  type: NotificationType;
  title: string;
  content: string;
  targetType: string;
  targetId?: string | null;
  projectId?: string | null;
  metadata?: any;
}) {
  const receiverIds = Array.from(new Set(input.receiverIds.filter(Boolean)));
  if (receiverIds.length === 0) return [];
  return prisma.notification.createMany({
    data: receiverIds.map((receiverId) => ({
      receiverId,
      type: input.type,
      title: input.title,
      content: input.content,
      targetType: input.targetType,
      targetId: input.targetId || null,
      projectId: input.projectId || null,
      metadata: input.metadata
    }))
  });
}

export async function reviewerIdsForProject(projectId: string | null | undefined) {
  if (!projectId) return [];
  const owners = await prisma.productionProjectMember.findMany({
    where: { projectId, role: ProductionProjectMemberRole.OWNER },
    select: { userId: true }
  });
  const projectDevelopers = projectId
    ? await prisma.productionProjectRoleGrant.findMany({
        where: {
          projectId,
          role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { userId: true }
      })
    : [];
  return Array.from(new Set([...owners.map((member) => member.userId), ...projectDevelopers.map((grant) => grant.userId)]));
}

export async function systemDisplayName(userId?: string | null) {
  if (!userId) return "未知账号";
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true, email: true } });
  return user?.displayName || user?.username || user?.email || "未知账号";
}

export async function buildInternalDisplayName(input: {
  submitterId?: string | null;
  stage: ProductionStage;
  originalName: string;
  date?: Date;
}) {
  const accountName = await systemDisplayName(input.submitterId);
  return `${dateStamp(input.date)} ${accountName} 智能出片 ${STAGE_LABEL[input.stage]} ${input.originalName}`;
}

export function mediaTypeFromMime(mimeType?: string | null) {
  if (mimeType?.startsWith("image/")) return MediaAssetType.IMAGE;
  if (mimeType?.startsWith("video/")) return MediaAssetType.VIDEO;
  if (mimeType?.startsWith("audio/")) return MediaAssetType.AUDIO;
  return MediaAssetType.DOCUMENT;
}

export function serializeAsset(asset: any) {
  const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata : {};
  const deletedProject = metadata.deletedProject && typeof metadata.deletedProject === "object" ? metadata.deletedProject : null;
  return {
    id: asset.id,
    projectId: asset.projectId,
    projectName: asset.project?.name || deletedProject?.name || null,
    deletedProjectId: deletedProject?.id || null,
    deletedProjectName: deletedProject?.name || null,
    stage: asset.stage,
    scope: asset.scope,
    reviewStatus: asset.reviewStatus,
    originalName: asset.originalName,
    displayName: asset.displayName,
    description: asset.description || "",
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    version: asset.version,
    currentSnapshotId: asset.currentSnapshotId,
    sourceType: asset.sourceType,
    sourceId: asset.sourceId,
    streamUrl: asset.mediaAssetId ? `/api/production-assets/${asset.id}/stream` : null,
    creator: asset.creator ? { id: asset.creator.id, displayName: asset.creator.displayName, email: asset.creator.email, username: asset.creator.username } : null,
    submitter: asset.submitter ? { id: asset.submitter.id, displayName: asset.submitter.displayName, email: asset.submitter.email, username: asset.submitter.username } : null,
    reviewer: asset.reviewer ? { id: asset.reviewer.id, displayName: asset.reviewer.displayName, email: asset.reviewer.email, username: asset.reviewer.username } : null,
    createdAt: asset.createdAt?.toISOString?.() || asset.createdAt,
    updatedAt: asset.updatedAt?.toISOString?.() || asset.updatedAt,
    archivedAt: asset.archivedAt?.toISOString?.() || asset.archivedAt,
    deletedAt: asset.deletedAt?.toISOString?.() || asset.deletedAt
  };
}

function payloadTextPreview(payload: any) {
  if (!payload) return "";
  if (typeof payload === "string") return payload.slice(0, 4000);
  const text = payload.text || payload.content || payload.output || payload.prompt || payload.result;
  if (typeof text === "string") return text.slice(0, 4000);
  return "";
}

function isTextLikeSnapshot(snapshot: any) {
  const mimeType = String(snapshot?.mimeType || "").toLowerCase();
  const ext = path.extname(String(snapshot?.originalName || "")).toLowerCase();
  return mimeType.startsWith("text/")
    || ["application/json", "application/csv", "application/xml", "application/javascript"].includes(mimeType)
    || [".txt", ".md", ".markdown", ".json", ".csv", ".xml", ".srt", ".vtt", ".log"].includes(ext);
}

function snapshotFileTextPreview(snapshot: any) {
  if (!isTextLikeSnapshot(snapshot)) return "";
  const storageKey = snapshot?.frozenStorageObjectKey || snapshot?.mediaAsset?.storageKey || snapshot?.mediaAsset?.fileKey;
  if (!storageKey || String(storageKey).includes("\0")) return "";
  try {
    const uploadsDir = path.resolve(getUploadsDir());
    const resolved = path.resolve(uploadsDir, storageKey);
    const relative = path.relative(uploadsDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return "";
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 256 * 1024) return "";
    return fs.readFileSync(resolved, "utf8").slice(0, 4000);
  } catch {
    return "";
  }
}

function snapshotPayloadPreview(snapshot: any) {
  const payload = snapshot?.frozenPayload;
  return payloadTextPreview(payload) || snapshotFileTextPreview(snapshot);
}

export function serializeSnapshot(snapshot: any) {
  return {
    id: snapshot.id,
    assetId: snapshot.assetId,
    version: snapshot.version,
    reviewStatus: snapshot.reviewStatus,
    originalName: snapshot.originalName,
    displayName: snapshot.displayName,
    mimeType: snapshot.mimeType,
    sizeBytes: snapshot.sizeBytes,
    reviewNote: snapshot.reviewNote,
    payloadPreview: snapshotPayloadPreview(snapshot),
    streamUrl: snapshot.asset?.id && snapshot.mediaAssetId ? `/api/production-assets/${snapshot.asset.id}/stream?snapshotId=${snapshot.id}` : null,
    asset: snapshot.asset ? serializeAsset(snapshot.asset) : undefined,
    createdBy: snapshot.createdBy ? { id: snapshot.createdBy.id, displayName: snapshot.createdBy.displayName, email: snapshot.createdBy.email, username: snapshot.createdBy.username } : null,
    reviewedBy: snapshot.reviewedBy ? { id: snapshot.reviewedBy.id, displayName: snapshot.reviewedBy.displayName, email: snapshot.reviewedBy.email, username: snapshot.reviewedBy.username } : null,
    createdAt: snapshot.createdAt?.toISOString?.() || snapshot.createdAt,
    reviewedAt: snapshot.reviewedAt?.toISOString?.() || snapshot.reviewedAt
  };
}

export function serializeInternalAssetItem(item: any) {
  if (item.kind === "reference") {
    return {
      kind: "reference",
      asset: serializeAsset(item.asset),
      snapshot: null,
      id: item.asset.id,
      projectId: item.asset.projectId,
      stage: item.asset.stage,
      reviewStatus: item.asset.reviewStatus,
      displayName: item.asset.displayName,
      originalName: item.asset.originalName,
      mimeType: item.asset.mimeType,
      sizeBytes: item.asset.sizeBytes,
      createdAt: item.asset.createdAt?.toISOString?.() || item.asset.createdAt,
      updatedAt: item.asset.updatedAt?.toISOString?.() || item.asset.updatedAt
    };
  }
  return {
    kind: "snapshot",
    snapshot: serializeSnapshot(item.snapshot),
    asset: item.snapshot.asset ? serializeAsset(item.snapshot.asset) : null,
    id: item.snapshot.id,
    projectId: item.snapshot.asset?.projectId || null,
    stage: item.snapshot.asset?.stage || null,
    reviewStatus: item.snapshot.reviewStatus,
    displayName: item.snapshot.displayName,
    originalName: item.snapshot.originalName,
    mimeType: item.snapshot.mimeType,
    sizeBytes: item.snapshot.sizeBytes,
    createdAt: item.snapshot.createdAt?.toISOString?.() || item.snapshot.createdAt,
    updatedAt: item.snapshot.asset?.updatedAt?.toISOString?.() || item.snapshot.asset?.updatedAt
  };
}

export async function assertAssetReadable(asset: any, user: RequestUser) {
  assertAuthed(user);
  if (asset.scope === ProductionAssetScope.PERSONAL) {
    if (asset.creatorId === user.id) return true;
    if (
      asset.projectId
      && [ProductionAssetReviewStatus.IN_REVIEW, ProductionAssetReviewStatus.APPROVED, ProductionAssetReviewStatus.REJECTED].includes(asset.reviewStatus)
      && await hasProjectManagerAccess(asset.projectId, user.id)
    ) {
      return true;
    }
    throw new HttpError(404, "资产不存在或无权访问。", "ASSET_NOT_FOUND");
  }
  if (asset.scope === ProductionAssetScope.TEAM) {
    if (asset.reviewStatus !== ProductionAssetReviewStatus.APPROVED || asset.archivedAt || asset.deletedAt) {
      throw new HttpError(404, "资产不存在或无权访问。", "ASSET_NOT_FOUND");
    }
    if (isGlobalReviewer(user)) return true;
    if (!asset.projectId) throw new HttpError(404, "资产不存在或无权访问。", "ASSET_NOT_FOUND");
    await ensureProjectMemberStrict(asset.projectId, user);
    return true;
  }
  if (asset.reviewStatus === ProductionAssetReviewStatus.REFERENCE) {
    const visible = await prisma.productionAssetReferenceVisibility.findUnique({
      where: { assetId_userId: { assetId: asset.id, userId: user.id } }
    });
    if (visible) return true;
  }
  throw new HttpError(404, "资产不存在或无权访问。", "ASSET_NOT_FOUND");
}

function isAssetBoundMedia(asset: any, media: { ownerId: string | null; visibility: any }) {
  if (media.visibility === MediaVisibility.PUBLIC) return true;
  if (!media.ownerId) return true;
  return [asset.creatorId, asset.submitterId, asset.reviewerId].filter(Boolean).includes(media.ownerId);
}

async function canReadProductionMedia(user: RequestUser, asset: any, media: { ownerId: string | null; visibility: any }) {
  if (canReadMediaAsset(user, media)) return true;
  if (asset.scope === ProductionAssetScope.TEAM && asset.reviewStatus === ProductionAssetReviewStatus.APPROVED && !asset.archivedAt && !asset.deletedAt && isAssetBoundMedia(asset, media)) {
    return true;
  }
  if (asset.scope === ProductionAssetScope.TEAM && asset.reviewStatus === ProductionAssetReviewStatus.APPROVED && !asset.archivedAt && !asset.deletedAt && isGlobalReviewer(user)) {
    return true;
  }
  if (
    asset.scope === ProductionAssetScope.PERSONAL
    && asset.projectId
    && [ProductionAssetReviewStatus.IN_REVIEW, ProductionAssetReviewStatus.APPROVED, ProductionAssetReviewStatus.REJECTED].includes(asset.reviewStatus)
    && isAssetBoundMedia(asset, media)
    && await hasProjectManagerAccess(asset.projectId, user.id)
  ) {
    return true;
  }
  if (asset.reviewStatus === ProductionAssetReviewStatus.REFERENCE && isAssetBoundMedia(asset, media)) {
    return true;
  }
  return false;
}

export async function assertMediaAssetUsableForProductionAsset(media: { ownerId: string | null; visibility: any }, user: RequestUser) {
  if (!canReadMediaAsset(user, media)) {
    throw new HttpError(404, "关联媒体不存在或无权访问。", "MEDIA_NOT_FOUND");
  }
}

export async function resolveMediaStream(asset: any, user: RequestUser, snapshotId?: string | null) {
  let mediaAssetId = asset.mediaAssetId;
  if (snapshotId) {
    const snapshot = await prisma.productionAssetSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot || (snapshot.assetId !== asset.id && asset.sourceId !== snapshot.id)) {
      throw new HttpError(404, "资产快照不存在。", "SNAPSHOT_NOT_FOUND");
    }
    mediaAssetId = snapshot.mediaAssetId || mediaAssetId;
  }
  if (!mediaAssetId) throw new HttpError(404, "资产没有可预览文件。", "ASSET_STREAM_NOT_FOUND");
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!media) throw new HttpError(404, "资产文件不存在。", "MEDIA_NOT_FOUND");
  if (!await canReadProductionMedia(user, asset, media)) {
    throw new HttpError(404, "资产文件不存在或无权访问。", "MEDIA_NOT_FOUND");
  }
  if (media.storageKey) {
    const uploadsDir = path.resolve(getUploadsDir());
    const resolved = path.resolve(uploadsDir, media.storageKey);
    const relative = path.relative(uploadsDir, resolved);
    if (!relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(resolved)) {
      markMediaAssetAccessed(media.id);
      return { type: "file" as const, path: resolved, mimeType: media.mimeType || "application/octet-stream", sizeBytes: media.sizeBytes || fs.statSync(resolved).size };
    }
  }
  return { type: "redirect" as const, url: protectedMediaUrl(media.id) };
}

export async function writeProductionEvent(input: {
  assetId: string;
  snapshotId?: string | null;
  actor: RequestUser;
  action: ProductionAssetReviewAction;
  note?: string | null;
  metadata?: any;
}) {
  return prisma.productionAssetReviewEvent.create({
    data: {
      assetId: input.assetId,
      snapshotId: input.snapshotId || null,
      actorId: input.actor.isGuest ? null : input.actor.id,
      action: input.action,
      note: input.note || null,
      metadata: input.metadata
    }
  });
}
