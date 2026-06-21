import { AuditAction, MediaAssetType, ProductionAssetReviewStatus, ProductionAssetScope, UserRole } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import type { RequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { canReadMediaAsset, protectedMediaUrl } from "../media/media.service";
import { defaultEditingTimeline, parseEditingTimeline, type EditingTimeline } from "./editing.schema";

const PRODUCTION_ASSET_REF_PREFIX = "production:";

export function canAccessEditingProject(user: RequestUser, project: { ownerId: string }) {
  if (user.isGuest) return false;
  if (user.role === UserRole.ADMIN) return true;
  return project.ownerId === user.id;
}

export async function assertEditingProjectAccess(projectId: string, user: RequestUser) {
  const project = await prisma.editingProject.findUnique({ where: { id: projectId } });
  if (!project || !canAccessEditingProject(user, project)) throw new HttpError(404, "剪辑工程不存在或无权访问。", "EDITING_PROJECT_NOT_FOUND");
  return project;
}

export function serializeEditingProject(project: any) {
  return {
    ...project,
    createdAt: project.createdAt?.toISOString?.() || project.createdAt,
    updatedAt: project.updatedAt?.toISOString?.() || project.updatedAt
  };
}

function clipKindToMediaType(kind: string) {
  if (kind === "VIDEO") return MediaAssetType.VIDEO;
  if (kind === "IMAGE") return MediaAssetType.IMAGE;
  if (kind === "AUDIO") return MediaAssetType.AUDIO;
  return null;
}

function assetTypeToClipKind(type: MediaAssetType) {
  if (type === MediaAssetType.VIDEO) return "VIDEO";
  if (type === MediaAssetType.IMAGE) return "IMAGE";
  if (type === MediaAssetType.AUDIO) return "AUDIO";
  return "DOCUMENT";
}

function parseProductionAssetRef(assetId: string) {
  if (!assetId.startsWith(PRODUCTION_ASSET_REF_PREFIX)) return null;
  const [, productionAssetId, snapshotId] = assetId.split(":");
  if (!productionAssetId) return null;
  return { productionAssetId, snapshotId: snapshotId || null };
}

function clipKindMatchesMime(kind: string, mimeType?: string | null) {
  if (kind === "VIDEO") return mimeType?.startsWith("video/");
  if (kind === "IMAGE") return mimeType?.startsWith("image/");
  if (kind === "AUDIO") return mimeType?.startsWith("audio/");
  return false;
}

async function canReadProductionAsset(user: RequestUser, asset: any) {
  if (asset.deletedAt || asset.archivedAt) return false;
  if (user.role === UserRole.ADMIN || user.role === UserRole.DEVELOPER) return true;
  if (asset.creatorId === user.id || asset.submitterId === user.id) return true;
  if (asset.scope !== ProductionAssetScope.TEAM || asset.reviewStatus !== ProductionAssetReviewStatus.APPROVED || !asset.projectId) return false;
  const member = await prisma.productionProjectMember.findUnique({
    where: { projectId_userId: { projectId: asset.projectId, userId: user.id } },
    select: { id: true }
  });
  return Boolean(member);
}

export async function validateEditingTimelineAssets(timeline: EditingTimeline, user: RequestUser) {
  const assetIds = Array.from(new Set(timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId).filter(Boolean)))) as string[];
  if (assetIds.length === 0) return;
  const productionRefs = assetIds.map(parseProductionAssetRef).filter(Boolean) as Array<{ productionAssetId: string; snapshotId: string | null }>;
  const productionRefIds = Array.from(new Set(productionRefs.map((ref) => ref.productionAssetId)));
  const mediaAssetIds = assetIds.filter((assetId) => !parseProductionAssetRef(assetId));

  const [assets, productionAssets] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { id: { in: mediaAssetIds } } }),
    productionRefIds.length > 0
      ? prisma.productionAsset.findMany({
          where: { id: { in: productionRefIds } },
          include: { snapshots: true }
        })
      : Promise.resolve([])
  ]);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const productionById = new Map(productionAssets.map((asset) => [asset.id, asset]));

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.assetId) continue;
      const productionRef = parseProductionAssetRef(clip.assetId);
      if (productionRef) {
        const asset = productionById.get(productionRef.productionAssetId);
        const snapshot = productionRef.snapshotId ? asset?.snapshots.find((item) => item.id === productionRef.snapshotId) : null;
        const mimeType = snapshot?.mimeType || asset?.mimeType || null;
        if (!asset || asset.deletedAt || !(await canReadProductionAsset(user, asset))) {
          throw new HttpError(404, "团队剪辑素材不存在或无权访问。", "EDITING_PRODUCTION_ASSET_NOT_ACCESSIBLE", { assetId: clip.assetId });
        }
        if (!asset.mediaAssetId && !snapshot?.mediaAssetId) {
          throw new HttpError(400, "团队剪辑素材没有可用媒体文件。", "EDITING_PRODUCTION_ASSET_NO_MEDIA", { assetId: clip.assetId });
        }
        if (!clipKindMatchesMime(clip.kind, mimeType)) {
          throw new HttpError(400, "团队剪辑素材类型与 clip 类型不匹配。", "EDITING_PRODUCTION_ASSET_TYPE_MISMATCH", { assetId: clip.assetId, mimeType });
        }
        continue;
      }
      const asset = byId.get(clip.assetId);
      if (!asset || !canReadMediaAsset(user, asset)) {
        throw new HttpError(404, "剪辑素材不存在或无权访问。", "EDITING_ASSET_NOT_ACCESSIBLE", { assetId: clip.assetId });
      }
      const expectedType = clipKindToMediaType(clip.kind);
      if (expectedType && asset.type !== expectedType) {
        throw new HttpError(400, "剪辑素材类型与 clip 类型不匹配。", "EDITING_ASSET_TYPE_MISMATCH", { assetId: clip.assetId, expectedType, actualType: asset.type });
      }
    }
  }
}

export async function listEditingProjects(user: RequestUser, productionProjectId?: string | null) {
  const projects = await prisma.editingProject.findMany({
    where: {
      ...(user.role === UserRole.ADMIN ? {} : { ownerId: user.id }),
      ...(productionProjectId ? { metadata: { path: ["productionProjectId"], equals: productionProjectId } } : {})
    },
    orderBy: { updatedAt: "desc" },
    take: 50
  });
  return projects.map(serializeEditingProject);
}

export async function createEditingProject(input: { user: RequestUser; title?: string; productionProjectId?: string | null }) {
  if (input.user.isGuest) throw new HttpError(401, "Authentication is required.");
  const timeline = defaultEditingTimeline();
  const project = await prisma.editingProject.create({
    data: {
      ownerId: input.user.id,
      title: (input.title || "未命名剪辑工程").trim().slice(0, 80) || "未命名剪辑工程",
      schemaVersion: timeline.version,
      durationMs: timeline.durationMs,
      timelineJson: timeline,
      metadata: input.productionProjectId ? { productionProjectId: input.productionProjectId } : undefined
    }
  });
  await writeAuditLog({ actor: input.user, action: AuditAction.CREATE, entityType: "EditingProject", entityId: project.id, metadata: { operation: "create_editing_project", productionProjectId: input.productionProjectId || null } });
  return serializeEditingProject(project);
}

export async function saveEditingTimeline(input: { user: RequestUser; projectId: string; timeline: unknown }) {
  const project = await assertEditingProjectAccess(input.projectId, input.user);
  let timeline: EditingTimeline;
  try {
    timeline = parseEditingTimeline(input.timeline);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, "剪辑时间线数据不合法。", "EDITING_TIMELINE_INVALID", error.issues);
    }
    const message = error instanceof Error ? error.message : "Invalid editing timeline payload.";
    throw new HttpError(message.includes("too large") ? 413 : 400, message, "EDITING_TIMELINE_INVALID");
  }
  await validateEditingTimelineAssets(timeline, input.user);
  const clipCount = timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  const updated = await prisma.$transaction(async (tx) => {
    return tx.editingProject.update({
      where: { id: project.id },
      data: {
        schemaVersion: timeline.version,
        durationMs: timeline.durationMs,
        timelineJson: timeline,
        metadata: {
          ...((project.metadata && typeof project.metadata === "object") ? project.metadata as Record<string, any> : {}),
          trackCount: timeline.tracks.length,
          clipCount
        }
      }
    });
  });
  await writeAuditLog({ actor: input.user, action: AuditAction.UPDATE, entityType: "EditingProject", entityId: project.id, metadata: { operation: "save_timeline", durationMs: timeline.durationMs, trackCount: timeline.tracks.length, clipCount } });
  return serializeEditingProject(updated);
}

function productionProjectIdOf(project: { metadata?: any }) {
  const metadata = project.metadata && typeof project.metadata === "object" ? project.metadata : {};
  const id = typeof metadata.productionProjectId === "string" ? metadata.productionProjectId.trim() : "";
  return id || null;
}

function timelineAssetIds(timelineJson: unknown) {
  const timeline = timelineJson && typeof timelineJson === "object" ? timelineJson as any : {};
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : [];
  return Array.from(new Set<string>(tracks.flatMap((track: any) => (
    Array.isArray(track?.clips)
      ? track.clips
          .map((clip: any) => typeof clip?.assetId === "string" ? clip.assetId.trim() : "")
          .filter((assetId: string) => assetId && !parseProductionAssetRef(assetId))
      : []
  ))));
}

function importedTimelineAssets(timelineJson: unknown) {
  const timeline = timelineJson && typeof timelineJson === "object" ? timelineJson as any : {};
  const imported = Array.isArray(timeline.metadata?.importedAssets) ? timeline.metadata.importedAssets : [];
  return imported
    .filter((asset: any) => asset?.id && asset?.title && asset?.url)
    .map((asset: any) => ({
      id: String(asset.id),
      title: String(asset.title),
      type: asset.type,
      kind: asset.kind,
      mimeType: asset.mimeType || null,
      sizeBytes: asset.sizeBytes ?? null,
      url: String(asset.url),
      createdAt: String(asset.createdAt || new Date(0).toISOString())
    }));
}

function serializeEditingAsset(asset: any) {
  return {
    id: asset.id,
    title: asset.title || asset.originalName || (asset.metadata as any)?.originalName || asset.storageKey || asset.id,
    type: asset.type,
    kind: assetTypeToClipKind(asset.type),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    url: protectedMediaUrl(asset.id),
    createdAt: asset.createdAt.toISOString()
  };
}

export async function listEditingAssets(input: { user: RequestUser; project: { id: string; metadata?: any; timelineJson?: any } }) {
  const { user, project } = input;
  if (user.isGuest) throw new HttpError(401, "Authentication is required.");
  const productionProjectId = productionProjectIdOf(project);
  const referencedAssetIds = timelineAssetIds(project.timelineJson);
  const projectMediaFilters = productionProjectId ? [
    { metadata: { path: ["pipelineAssistantProjectId"], equals: productionProjectId } },
    { metadata: { path: ["productionProjectId"], equals: productionProjectId } },
    { metadata: { path: ["projectId"], equals: productionProjectId } }
  ] : [];
  const assetFilters = [
    ...(referencedAssetIds.length ? [{ id: { in: referencedAssetIds } }] : []),
    ...projectMediaFilters
  ];
  const importedAssets = importedTimelineAssets(project.timelineJson);
  if (assetFilters.length === 0) return importedAssets;
  const assets = await prisma.mediaAsset.findMany({
    where: {
      type: { in: [MediaAssetType.VIDEO, MediaAssetType.IMAGE, MediaAssetType.AUDIO] },
      ownerId: user.id,
      OR: assetFilters as any
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  const byId = new Map<string, any>();
  for (const asset of importedAssets) byId.set(asset.id, asset);
  for (const asset of assets.filter((item) => canReadMediaAsset(user, item))) {
    byId.set(asset.id, serializeEditingAsset(asset));
  }
  return Array.from(byId.values());
}
