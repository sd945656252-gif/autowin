import fs from "fs";
import path from "path";
import type express from "express";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getPrivateStorageDir, getUploadsDir } from "../../shared/storage-paths";
import { sendApiError } from "../../shared/http";
import { normalizeEmail, normalizeUsername, passwordHash, requireRoles, serializeLocalUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";

const ROLE_VALUES = new Set<string>(Object.values(UserRole));
const STATUS_VALUES = new Set<string>(Object.values(UserStatus));
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function resolveContainedPath(rootDir: string, key: string) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, key);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return resolvedPath;
}

function resolvePrivateMediaPath(fileKey: string) {
  return resolveContainedPath(path.join(getPrivateStorageDir(), "media"), fileKey);
}

function resolveUploadMediaPath(storageKey: string) {
  return resolveContainedPath(getUploadsDir(), storageKey);
}

function safeRemoveFile(filePath?: string | null) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch (error) {
    console.warn("[AdminUserDelete] Failed to remove user media file:", error);
  }
}

function formatLastSeenLabel(lastSeenAt?: Date | null) {
  if (!lastSeenAt) return "从未在线";
  const diffMs = Math.max(0, Date.now() - lastSeenAt.getTime());
  if (diffMs <= ONLINE_WINDOW_MS) return "在线";

  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "离线不足 1 小时";
  if (hours < 24) return `离线 ${hours} 小时`;

  const days = Math.floor(hours / 24);
  if (days > 7) return "离线 7 天以上";
  return `离线 ${days} 天`;
}

function serializeUser(user: any) {
  const lastSeenAt = user.lastSeenAt ? new Date(user.lastSeenAt) : null;
  const online = Boolean(lastSeenAt && Date.now() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS);
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    lastSeenAt: user.lastSeenAt,
    online,
    lastSeenLabel: online ? "在线" : formatLastSeenLabel(lastSeenAt),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function purgeUserForDeletion(input: { actor: { id: string }; targetId: string; req: express.Request }) {
  if (input.targetId === input.actor.id) {
    return { id: input.targetId, success: false, error: "不能删除当前登录账号。" };
  }

  const target = await prisma.user.findUnique({
    where: { id: input.targetId },
    include: {
      _count: {
        select: {
          workflows: true,
          mediaAssets: true,
          auditLogs: true,
          sessions: true,
          oauthAccounts: true,
          createdShowcaseWorks: true,
          scriptProjects: true,
          editingProjects: true
        }
      }
    }
  });

  if (!target) {
    return { id: input.targetId, success: false, error: "用户不存在。" };
  }

  const [ownedMedia, ownedWorkflows, ownedPromptHistoryItems] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { ownerId: target.id },
      select: { url: true, storageKey: true, fileKey: true, metadata: true }
    }),
    prisma.workflow.findMany({
      where: { ownerId: target.id },
      select: { id: true }
    }),
    prisma.promptHistoryItem.findMany({
      where: { ownerId: target.id },
      select: { id: true }
    })
  ]);

  const mediaFilePaths = Array.from(new Set(ownedMedia.flatMap((asset) => {
    const storageKind = typeof asset.metadata === "object" && asset.metadata && "storage" in asset.metadata
      ? String((asset.metadata as { storage?: unknown }).storage || "")
      : "";
    if (asset.url?.startsWith("private://") || storageKind === "private-local") {
      return asset.fileKey ? [resolvePrivateMediaPath(asset.fileKey)] : [];
    }
    if (asset.url?.startsWith("/uploads/") || storageKind === "local") {
      return asset.storageKey ? [resolveUploadMediaPath(asset.storageKey)] : [];
    }
    return [];
  }).filter((filePath): filePath is string => Boolean(filePath))));
  const workflowIds = ownedWorkflows.map((workflow) => workflow.id);
  const historyIds = ownedPromptHistoryItems.map((item) => item.id);

  const cleanupCounts = await prisma.$transaction(async (tx) => {
    const workflowRunIds = workflowIds.length > 0
      ? (await tx.workflowRun.findMany({ where: { workflowId: { in: workflowIds } }, select: { id: true } })).map((run) => run.id)
      : [];

    const results = {
      promptHistoryAttachments: historyIds.length > 0 ? (await tx.promptHistoryAttachment.deleteMany({ where: { historyId: { in: historyIds } } })).count : 0,
      promptHistoryItems: (await tx.promptHistoryItem.deleteMany({ where: { ownerId: target.id } })).count,
      savedPrompts: (await tx.savedPrompt.deleteMany({ where: { ownerId: target.id } })).count,
      chatMessages: (await tx.chatMessage.deleteMany({ where: { userId: target.id } })).count,
      customApiConfigs: (await tx.customApiConfig.deleteMany({ where: { ownerId: target.id } })).count,
      editingProjects: (await tx.editingProject.deleteMany({ where: { ownerId: target.id } })).count,
      scriptProcessingJobs: (await tx.scriptProcessingJob.deleteMany({ where: { ownerId: target.id } })).count,
      scriptProjectVersionsByCreator: (await tx.scriptProjectVersion.updateMany({ where: { createdById: target.id }, data: { createdById: null } })).count,
      modelCapabilityRevisionsByCreator: (await tx.modelCapabilityRevision.updateMany({ where: { createdById: target.id }, data: { createdById: null } })).count,
      workflowNodeRuns: workflowRunIds.length > 0 ? (await tx.workflowNodeRun.deleteMany({ where: { runId: { in: workflowRunIds } } })).count : 0,
      workflowRuns: workflowIds.length > 0 ? (await tx.workflowRun.deleteMany({ where: { workflowId: { in: workflowIds } } })).count : 0,
      workflows: (await tx.workflow.deleteMany({ where: { ownerId: target.id } })).count,
      scriptProjects: (await tx.scriptProject.deleteMany({ where: { ownerId: target.id } })).count,
      mediaAssets: (await tx.mediaAsset.deleteMany({ where: { ownerId: target.id } })).count,
      showcaseWorksDetached: (await tx.showcaseWork.updateMany({ where: { createdById: target.id }, data: { createdById: null } })).count,
      auditLogsByActor: (await tx.auditLog.deleteMany({ where: { actorId: target.id } })).count,
      auditLogsAnonymized: (await tx.auditLog.updateMany({ where: { actorId: target.id }, data: { actorId: null } })).count,
      authSessions: (await tx.authSession.deleteMany({ where: { userId: target.id } })).count,
      oauthAccounts: (await tx.oAuthAccount.deleteMany({ where: { userId: target.id } })).count
    };

    await tx.user.delete({ where: { id: target.id } });
    return results;
  });

  mediaFilePaths.forEach(safeRemoveFile);

  await writeAuditLog({
    actor: { id: input.actor.id, role: UserRole.ADMIN, isGuest: false },
    action: "DELETE",
    entityType: "UserAccount",
    entityId: null,
    req: input.req,
    metadata: {
      strategy: "hard_delete_purge_account_data",
      associationPolicy: "owned user data purged; global resources detached; deletion audit is redacted",
      beforeCounts: target._count,
      cleanupCounts,
      removedLocalFiles: mediaFilePaths.length
    },
    beforeJson: { status: target.status, role: target.role },
    afterJson: { deleted: true, accountIdentityRedacted: true }
  });

  return { id: target.id, success: true, counts: target._count, cleanupCounts, removedLocalFiles: mediaFilePaths.length };
}

export function registerAdminRoutes(app: express.Express) {
  app.get("/api/users", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN]);
      const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
      res.json({ success: true, users: users.map(serializeUser) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to list users.");
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const actor = await requireRoles(req, [UserRole.ADMIN]);
      const email = normalizeEmail(String(req.body?.email || ""));
      const username = normalizeUsername(String(req.body?.username || email.split("@")[0] || "user"));
      const displayName = String(req.body?.displayName || username).trim();
      const password = String(req.body?.password || "");
      const role = String(req.body?.role || UserRole.USER) as UserRole;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ success: false, error: "Invalid email address." });
        return;
      }
      if (!username) {
        res.status(400).json({ success: false, error: "username is required." });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ success: false, error: "Password must be at least 8 characters." });
        return;
      }
      if (!ROLE_VALUES.has(role)) {
        res.status(400).json({ success: false, error: "Invalid role." });
        return;
      }

      const user = await prisma.user.create({
        data: {
          email,
          username,
          displayName,
          passwordHash: passwordHash(password),
          role,
          status: UserStatus.ACTIVE
        }
      });

      await writeAuditLog({
        actor,
        action: "CREATE",
        entityType: "User",
        entityId: user.id,
        req,
        afterJson: { email, username, role }
      });

      res.status(201).json({ success: true, user: serializeUser(user) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to create user.");
    }
  });

  app.patch("/api/users/:id/role", async (req, res) => {
    try {
      const actor = await requireRoles(req, [UserRole.ADMIN]);
      const role = String(req.body?.role || "") as UserRole;
      if (!ROLE_VALUES.has(role)) {
        res.status(400).json({ success: false, error: "Invalid role." });
        return;
      }

      const before = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!before) {
        res.status(404).json({ success: false, error: "User not found." });
        return;
      }
      const user = await prisma.user.update({ where: { id: before.id }, data: { role } });

      await writeAuditLog({
        actor,
        action: "UPDATE",
        entityType: "UserRole",
        entityId: before.id,
        req,
        beforeJson: { role: before.role },
        afterJson: { role }
      });

      res.json({ success: true, user: serializeUser(user) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to update user role.");
    }
  });

  app.patch("/api/users/:id/status", async (req, res) => {
    try {
      const actor = await requireRoles(req, [UserRole.ADMIN]);
      const status = String(req.body?.status || "") as UserStatus;
      if (!STATUS_VALUES.has(status)) {
        res.status(400).json({ success: false, error: "Invalid status." });
        return;
      }

      const before = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!before) {
        res.status(404).json({ success: false, error: "User not found." });
        return;
      }
      const user = await prisma.user.update({ where: { id: before.id }, data: { status } });
      if (status === UserStatus.DISABLED) {
        await prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }

      await writeAuditLog({
        actor,
        action: "UPDATE",
        entityType: "UserStatus",
        entityId: before.id,
        req,
        beforeJson: { status: before.status },
        afterJson: { status }
      });

      res.json({ success: true, user: serializeUser(user) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to update user status.");
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const actor = await requireRoles(req, [UserRole.ADMIN]);
      const result = await purgeUserForDeletion({ actor: { id: actor.id }, targetId: req.params.id, req });
      if (!result.success) {
        res.status(result.error === "用户不存在。" ? 404 : 400).json({ success: false, error: result.error, result });
        return;
      }
      res.json({ success: true, result });
    } catch (error: any) {
      sendApiError(res, error, "Failed to delete user account.");
    }
  });

  app.post("/api/users/bulk-delete", async (req, res) => {
    try {
      const actor = await requireRoles(req, [UserRole.ADMIN]);
      const rawIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      const userIds = Array.from(new Set(rawIds.map((id) => String(id || "").trim()).filter(Boolean))) as string[];
      const targetUserIds = userIds.slice(0, 100);
      if (targetUserIds.length === 0) {
        res.status(400).json({ success: false, error: "请选择要删除的账号。" });
        return;
      }

      const results = [];
      for (const targetId of targetUserIds) {
        try {
          results.push(await purgeUserForDeletion({ actor: { id: actor.id }, targetId, req }));
        } catch (error: any) {
          results.push({ id: targetId, success: false, error: error?.message || "删除失败。" });
        }
      }

      const summary = {
        requested: targetUserIds.length,
        succeeded: results.filter((item: any) => item.success && !item.skipped).length,
        skipped: results.filter((item: any) => item.success && item.skipped).length,
        failed: results.filter((item: any) => !item.success).length
      };

      await writeAuditLog({
        actor,
        action: "DELETE",
        entityType: "UserAccountBulk",
        req,
        metadata: { strategy: "hard_delete_purge_account_data", summary, targetCount: targetUserIds.length }
      });

      res.json({ success: summary.failed === 0, partial: summary.failed > 0, summary, results });
    } catch (error: any) {
      sendApiError(res, error, "Failed to bulk delete user accounts.");
    }
  });

  app.get("/api/audit-logs", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN]);
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: Math.min(Number(req.query.limit || 100), 300),
        include: { actor: true }
      });
      res.json({
        success: true,
        logs: logs.map((log) => ({
          id: log.id,
          actorId: log.actorId,
          actor: log.actor ? serializeLocalUser(log.actor) : null,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          ip: log.ip,
          userAgent: log.userAgent,
          metadata: log.metadata,
          beforeJson: log.beforeJson,
          afterJson: log.afterJson,
          createdAt: log.createdAt
        }))
      });
    } catch (error: any) {
      sendApiError(res, error, "Failed to list audit logs.");
    }
  });
}
