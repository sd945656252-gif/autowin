import { MediaAsset, NotificationAudience, NotificationType, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import type { RequestUser } from "../auth/auth.shared";
import { canReadMediaAsset } from "../media/media.service";

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type MessageCategory = "NOTICE" | "BROADCAST" | "ANNOUNCEMENT";

export function defaultNotificationExpiresAt(date = new Date()) {
  return new Date(date.getTime() + RETENTION_MS);
}

export function notificationCategory(type: NotificationType, audience?: NotificationAudience | null): MessageCategory {
  if (type === NotificationType.ANNOUNCEMENT || audience === NotificationAudience.GLOBAL) return "ANNOUNCEMENT";
  if (type === NotificationType.PROJECT_BROADCAST || audience === NotificationAudience.PROJECT) return "BROADCAST";
  return "NOTICE";
}

export function notificationCategoryLabel(category: MessageCategory) {
  if (category === "ANNOUNCEMENT") return "公告";
  if (category === "BROADCAST") return "播报";
  return "通知";
}

function mediaDisplayName(asset: MediaAsset) {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Record<string, any> : {};
  return asset.originalName || metadata.originalName || asset.title || asset.fileKey || asset.storageKey || asset.id;
}

async function loadReadableAttachments(actor: RequestUser, mediaAssetIds: string[] = []) {
  const ids = Array.from(new Set(mediaAssetIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: ids } } });
  if (assets.length !== ids.length) {
    throw new HttpError(404, "附件不存在或已被删除。", "NOTIFICATION_ATTACHMENT_NOT_FOUND");
  }
  const unreadable = assets.find((asset) => !canReadMediaAsset(actor, asset));
  if (unreadable) {
    throw new HttpError(403, "无权使用该附件。", "NOTIFICATION_ATTACHMENT_FORBIDDEN");
  }
  return assets;
}

export function serializeNotification(item: any) {
  const category = notificationCategory(item.type, item.audience);
  return {
    id: item.id,
    type: item.type,
    category,
    categoryLabel: notificationCategoryLabel(category),
    audience: item.audience || NotificationAudience.USER,
    title: item.title,
    content: item.content,
    targetType: item.targetType,
    targetId: item.targetId,
    projectId: item.projectId,
    projectName: item.project?.name || null,
    sender: item.sender ? {
      id: item.sender.id,
      displayName: item.sender.displayName,
      email: item.sender.email,
      username: item.sender.username
    } : null,
    metadata: item.metadata,
    readAt: item.readAt?.toISOString?.() || item.readAt || null,
    deletedAt: item.deletedAt?.toISOString?.() || item.deletedAt || null,
    expiresAt: item.expiresAt?.toISOString?.() || item.expiresAt || null,
    createdAt: item.createdAt?.toISOString?.() || item.createdAt,
    attachments: (item.attachments || []).map((attachment: any) => ({
      id: attachment.id,
      mediaAssetId: attachment.mediaAssetId,
      displayName: attachment.displayName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      previewUrl: `/api/notifications/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(attachment.id)}/stream`,
      downloadUrl: `/api/notifications/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(attachment.id)}/stream?download=true`,
      createdAt: attachment.createdAt?.toISOString?.() || attachment.createdAt
    }))
  };
}

export async function createNotificationRecords(input: {
  receiverIds: string[];
  senderId?: string | null;
  type: NotificationType;
  audience: NotificationAudience;
  title: string;
  content: string;
  targetType: string;
  targetId?: string | null;
  projectId?: string | null;
  metadata?: any;
  attachmentMediaAssetIds?: string[];
  actor: RequestUser;
}) {
  const receiverIds = Array.from(new Set(input.receiverIds.filter(Boolean)));
  if (receiverIds.length === 0) return [];
  const assets = await loadReadableAttachments(input.actor, input.attachmentMediaAssetIds);
  const expiresAt = defaultNotificationExpiresAt();

  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const receiverId of receiverIds) {
      const notification = await tx.notification.create({
        data: {
          receiverId,
          senderId: input.senderId || null,
          type: input.type,
          audience: input.audience,
          title: input.title,
          content: input.content,
          targetType: input.targetType,
          targetId: input.targetId || null,
          projectId: input.projectId || null,
          metadata: input.metadata,
          expiresAt,
          attachments: assets.length > 0 ? {
            create: assets.map((asset) => ({
              mediaAssetId: asset.id,
              displayName: mediaDisplayName(asset),
              mimeType: asset.mimeType,
              sizeBytes: asset.sizeBytes
            }))
          } : undefined
        },
        include: {
          project: true,
          sender: { select: { id: true, displayName: true, email: true, username: true } },
          attachments: true
        }
      });
      created.push(notification);
    }
    return created;
  });
}

export async function activeUserIds() {
  const users = await prisma.user.findMany({
    where: { status: UserStatus.ACTIVE },
    select: { id: true }
  });
  return users.map((user) => user.id);
}

export function canPublishAnnouncement(user: RequestUser) {
  return !user.isGuest && (user.role === UserRole.ADMIN || user.role === UserRole.DEVELOPER);
}

export async function cleanupExpiredNotifications(now = new Date()) {
  const olderThan = new Date(now.getTime() - RETENTION_MS);
  return prisma.notification.deleteMany({
    where: {
      OR: [
        { createdAt: { lt: olderThan } },
        { expiresAt: { lt: now } }
      ]
    }
  });
}

let cleanupTimerStarted = false;

export function scheduleNotificationCleanup() {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  cleanupExpiredNotifications().catch((error) => {
    console.warn("[Notifications] Initial cleanup failed:", error);
  });
  const timer = setInterval(() => {
    cleanupExpiredNotifications().catch((error) => {
      console.warn("[Notifications] Scheduled cleanup failed:", error);
    });
  }, 6 * 60 * 60 * 1000);
  timer.unref?.();
}
