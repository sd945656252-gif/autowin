import fs from "fs";
import type express from "express";
import { NotificationAudience, NotificationType, UserStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { markMediaAssetAccessed, resolveLocalUploadPath } from "../media/media.service";
import { ensureProjectManager } from "../production-assets/production-assets.shared";
import {
  activeUserIds,
  canPublishAnnouncement,
  createNotificationRecords,
  scheduleNotificationCleanup,
  serializeNotification
} from "./notifications.service";

const notificationListQuerySchema = z.object({
  unread: z.string().optional(),
  category: z.enum(["NOTICE", "BROADCAST", "ANNOUNCEMENT"]).optional()
});

const attachmentIdsSchema = z.array(z.string().min(1)).max(10).optional();

const createNoticeSchema = z.object({
  projectId: z.string().min(1),
  receiverId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(5000),
  attachmentMediaAssetIds: attachmentIdsSchema
});

const createBroadcastSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(5000),
  attachmentMediaAssetIds: attachmentIdsSchema
});

const createAnnouncementSchema = z.object({
  scope: z.literal("GLOBAL").default("GLOBAL"),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(5000),
  attachmentMediaAssetIds: attachmentIdsSchema
});

function activeNotificationWhere(userId: string) {
  const now = new Date();
  return {
    receiverId: userId,
    deletedAt: null,
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: now } }
    ]
  };
}

function categoryWhere(category?: "NOTICE" | "BROADCAST" | "ANNOUNCEMENT") {
  if (category === "ANNOUNCEMENT") {
    return {
      OR: [
        { type: NotificationType.ANNOUNCEMENT },
        { audience: NotificationAudience.GLOBAL }
      ]
    };
  }
  if (category === "BROADCAST") {
    return {
      OR: [
        { type: NotificationType.PROJECT_BROADCAST },
        { audience: NotificationAudience.PROJECT }
      ]
    };
  }
  if (category === "NOTICE") {
    return {
      AND: [
        { type: { notIn: [NotificationType.PROJECT_BROADCAST, NotificationType.ANNOUNCEMENT] } },
        { audience: NotificationAudience.USER }
      ]
    };
  }
  return {};
}

function notificationInclude() {
  return {
    project: true,
    sender: { select: { id: true, displayName: true, email: true, username: true } },
    attachments: { orderBy: { createdAt: "asc" as const } }
  };
}

async function projectMemberIds(projectId: string) {
  const members = await prisma.productionProjectMember.findMany({
    where: {
      projectId,
      user: { status: UserStatus.ACTIVE }
    },
    select: { userId: true }
  });
  return members.map((member) => member.userId);
}

async function assertProjectReceiver(projectId: string, receiverId: string) {
  const member = await prisma.productionProjectMember.findUnique({
    where: { projectId_userId: { projectId, userId: receiverId } }
  });
  if (!member) throw new HttpError(400, "接收人必须是当前项目成员。", "NOTIFICATION_RECEIVER_NOT_PROJECT_MEMBER");
}

function contentDisposition(name: string, download: boolean) {
  const safeName = name.replace(/[\r\n"]/g, "_").slice(0, 180) || "attachment";
  return `${download ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export function registerNotificationRoutes(app: express.Express) {
  scheduleNotificationCleanup();

  app.get("/api/notifications", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const query = notificationListQuerySchema.parse(req.query || {});
      const unreadOnly = query.unread === "true";
      const notifications = await prisma.notification.findMany({
        where: {
          AND: [
            activeNotificationWhere(user.id),
            unreadOnly ? { readAt: null } : {},
            categoryWhere(query.category)
          ]
        },
        include: notificationInclude(),
        orderBy: { createdAt: "desc" },
        take: 100
      });
      res.json({ success: true, notifications: notifications.map(serializeNotification) });
    } catch (error) {
      sendApiError(res, error, "通知列表读取失败。");
    }
  });

  app.get("/api/notifications/unread-count", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const count = await prisma.notification.count({ where: { ...activeNotificationWhere(user.id), readAt: null } });
      res.json({ success: true, count });
    } catch (error) {
      sendApiError(res, error, "未读通知数量读取失败。");
    }
  });

  app.get("/api/notifications/announcement-projects", async (req, res) => {
    try {
      const user = await requireAuth(req);
      if (!canPublishAnnouncement(user)) throw new HttpError(403, "Forbidden.", "ANNOUNCEMENT_PROJECTS_FORBIDDEN");
      res.json({ success: true, projects: [] });
    } catch (error) {
      sendApiError(res, error, "公告项目列表读取失败。");
    }
  });

  app.get("/api/notifications/:id", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const notification = await prisma.notification.findFirst({
        where: { id: req.params.id, ...activeNotificationWhere(user.id) },
        include: notificationInclude()
      });
      if (!notification) throw new HttpError(404, "通知不存在。", "NOTIFICATION_NOT_FOUND");
      res.json({ success: true, notification: serializeNotification(notification) });
    } catch (error) {
      sendApiError(res, error, "通知详情读取失败。");
    }
  });

  app.post("/api/notifications/:id/read", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const existing = await prisma.notification.findFirst({ where: { id: req.params.id, ...activeNotificationWhere(user.id) } });
      if (!existing) throw new HttpError(404, "通知不存在。", "NOTIFICATION_NOT_FOUND");
      const notification = await prisma.notification.update({
        where: { id: existing.id },
        data: { readAt: existing.readAt || new Date() },
        include: notificationInclude()
      });
      res.json({ success: true, notification: serializeNotification(notification) });
    } catch (error) {
      sendApiError(res, error, "通知已读状态更新失败。");
    }
  });

  app.delete("/api/notifications/:id", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const existing = await prisma.notification.findFirst({ where: { id: req.params.id, ...activeNotificationWhere(user.id) } });
      if (!existing) throw new HttpError(404, "通知不存在。", "NOTIFICATION_NOT_FOUND");
      await prisma.notification.update({
        where: { id: existing.id },
        data: { deletedAt: existing.deletedAt || new Date() }
      });
      res.json({ success: true, deleted: true });
    } catch (error) {
      sendApiError(res, error, "通知删除失败。");
    }
  });

  app.get("/api/notifications/:id/attachments/:attachmentId/stream", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const attachment = await prisma.notificationAttachment.findFirst({
        where: {
          id: req.params.attachmentId,
          notificationId: req.params.id,
          notification: activeNotificationWhere(user.id)
        },
        include: { mediaAsset: true }
      });
      if (!attachment) throw new HttpError(404, "附件不存在。", "NOTIFICATION_ATTACHMENT_NOT_FOUND");
      if (!attachment.mediaAsset.storageKey) throw new HttpError(404, "附件文件不可预览。", "NOTIFICATION_ATTACHMENT_STREAM_NOT_FOUND");
      const filePath = resolveLocalUploadPath(attachment.mediaAsset.storageKey);
      if (!fs.existsSync(filePath)) throw new HttpError(404, "附件文件不存在。", "NOTIFICATION_ATTACHMENT_FILE_NOT_FOUND");
      const stat = fs.statSync(filePath);
      markMediaAssetAccessed(attachment.mediaAssetId);
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": attachment.mimeType || attachment.mediaAsset.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition(attachment.displayName, String(req.query.download || "") === "true"),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes"
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      sendApiError(res, error, "附件读取失败。");
    }
  });

  app.post("/api/notifications/notice", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = createNoticeSchema.parse(req.body || {});
      await ensureProjectManager(body.projectId, user);
      await assertProjectReceiver(body.projectId, body.receiverId);
      const notifications = await createNotificationRecords({
        receiverIds: [body.receiverId],
        senderId: user.id,
        type: NotificationType.USER_NOTICE,
        audience: NotificationAudience.USER,
        title: body.title,
        content: body.content,
        targetType: "Notification",
        targetId: null,
        projectId: body.projectId,
        attachmentMediaAssetIds: body.attachmentMediaAssetIds,
        actor: user
      });
      res.status(201).json({ success: true, notifications: notifications.map(serializeNotification) });
    } catch (error) {
      sendApiError(res, error, "通知发布失败。");
    }
  });

  app.post("/api/notifications/broadcast", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = createBroadcastSchema.parse(req.body || {});
      await ensureProjectManager(body.projectId, user);
      const receiverIds = await projectMemberIds(body.projectId);
      const notifications = await createNotificationRecords({
        receiverIds,
        senderId: user.id,
        type: NotificationType.PROJECT_BROADCAST,
        audience: NotificationAudience.PROJECT,
        title: body.title,
        content: body.content,
        targetType: "ProductionProject",
        targetId: body.projectId,
        projectId: body.projectId,
        attachmentMediaAssetIds: body.attachmentMediaAssetIds,
        actor: user
      });
      res.status(201).json({ success: true, count: notifications.length, notifications: notifications.map(serializeNotification) });
    } catch (error) {
      sendApiError(res, error, "播报发布失败。");
    }
  });

  app.post("/api/notifications/announcements", async (req, res) => {
    try {
      const user = await requireAuth(req);
      if (!canPublishAnnouncement(user)) throw new HttpError(403, "Forbidden.", "ANNOUNCEMENT_PUBLISH_FORBIDDEN");
      const body = createAnnouncementSchema.parse(req.body || {});
      const receiverIds = await activeUserIds();
      const notifications = await createNotificationRecords({
        receiverIds,
        senderId: user.id,
        type: NotificationType.ANNOUNCEMENT,
        audience: NotificationAudience.GLOBAL,
        title: body.title,
        content: body.content,
        targetType: "Global",
        targetId: null,
        projectId: null,
        attachmentMediaAssetIds: body.attachmentMediaAssetIds,
        actor: user
      });
      res.status(201).json({ success: true, count: notifications.length, notifications: notifications.map(serializeNotification) });
    } catch (error) {
      sendApiError(res, error, "公告发布失败。");
    }
  });
}
