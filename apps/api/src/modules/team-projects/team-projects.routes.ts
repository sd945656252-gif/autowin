import type express from "express";
import {
  AuditAction,
  NotificationType,
  ProductionAssetReviewAction,
  ProductionAssetReviewStatus,
  ProductionAssetScope,
  ProductionProjectGrantRole,
  ProductionProjectMemberRole,
  ProductionStage
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import {
  ensureProjectManager,
  ensureProjectMemberStrict,
  hasProjectManagerAccess,
  notifyUsers,
  serializeAsset,
  serializeInternalAssetItem,
  serializeSnapshot,
  systemDisplayName
} from "../production-assets/production-assets.shared";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  projectKind: z.enum(["PERSONAL", "TEAM"]).default("TEAM"),
  workflowType: z.string().trim().max(80).optional()
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(ProductionProjectMemberRole).default(ProductionProjectMemberRole.MEMBER)
});

const grantDeveloperSchema = z.object({
  userId: z.string().min(1),
  expiresAt: z.string().datetime().optional()
});

const swapTeamLeaderSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1)
});

const searchUserSchema = z.object({
  query: z.string().trim().min(1).max(120)
});

const listProjectAssetsSchema = z.object({
  view: z.enum(["team", "review"]).default("team"),
  reviewStatus: z.nativeEnum(ProductionAssetReviewStatus).optional(),
  stage: z.nativeEnum(ProductionStage).optional(),
  search: z.string().trim().max(120).optional()
});

const reviewBodySchema = z.object({
  note: z.string().trim().max(1000).optional()
});

function assetTextFilter(search?: string) {
  if (!search) return undefined;
  return [
    { displayName: { contains: search, mode: "insensitive" as const } },
    { originalName: { contains: search, mode: "insensitive" as const } },
    { description: { contains: search, mode: "insensitive" as const } },
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

function serializeProject(project: any) {
  const metadata = project.metadata && typeof project.metadata === "object" ? project.metadata : {};
  const projectKind = metadata.projectKind === "PERSONAL" ? "PERSONAL" : "TEAM";
  return {
    id: project.id,
    name: project.name,
    description: project.description || "",
    createdById: project.createdById,
    projectKind,
    workflowType: typeof metadata.workflowType === "string" ? metadata.workflowType : null,
    memberCount: project._count?.members,
    createdAt: project.createdAt?.toISOString?.() || project.createdAt,
    updatedAt: project.updatedAt?.toISOString?.() || project.updatedAt
  };
}

async function teamLeaderCount(projectId: string) {
  const [owners, grants] = await Promise.all([
    prisma.productionProjectMember.count({ where: { projectId, role: ProductionProjectMemberRole.OWNER } }),
    prisma.productionProjectRoleGrant.count({
      where: {
        projectId,
        role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    })
  ]);
  return owners + grants;
}

async function ensureProjectNameAvailable(input: { createdById: string; name: string; excludeProjectId?: string }) {
  const normalizedName = input.name.trim();
  const existing = await prisma.productionProject.findFirst({
    where: {
      createdById: input.createdById,
      name: { equals: normalizedName, mode: "insensitive" },
      ...(input.excludeProjectId ? { id: { not: input.excludeProjectId } } : {})
    },
    select: { id: true }
  });
  if (existing) {
    throw new HttpError(409, "不能出现同名的项目，请更改项目名称后再创建。", "PROJECT_NAME_ALREADY_EXISTS", { name: normalizedName });
  }
}

function projectKindWhere(kind?: string) {
  if (kind === "PERSONAL") return { metadata: { path: ["projectKind"], equals: "PERSONAL" } };
  if (kind === "TEAM") {
    return {
      NOT: { metadata: { path: ["projectKind"], equals: "PERSONAL" } }
    };
  }
  return {};
}

function serializeMember(member: any) {
  const activeGrant = (member.project?.roleGrants || member.user?.productionProjectRoleGrants || []).find((grant: any) => {
    if (grant.userId && grant.userId !== member.userId) return false;
    if (grant.revokedAt) return false;
    if (grant.expiresAt && new Date(grant.expiresAt) <= new Date()) return false;
    return grant.role === ProductionProjectGrantRole.PROJECT_DEVELOPER;
  });
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    projectRole: activeGrant ? ProductionProjectGrantRole.PROJECT_DEVELOPER : null,
    teamRole: activeGrant ? "TEAM_LEADER" : null,
    projectDeveloperExpiresAt: activeGrant?.expiresAt?.toISOString?.() || activeGrant?.expiresAt || null,
    teamLeaderExpiresAt: activeGrant?.expiresAt?.toISOString?.() || activeGrant?.expiresAt || null,
    user: member.user ? {
      id: member.user.id,
      email: member.user.email,
      username: member.user.username,
      displayName: member.user.displayName,
      role: member.user.role,
      status: member.user.status
    } : null,
    createdAt: member.createdAt?.toISOString?.() || member.createdAt
  };
}

export function registerTeamProjectRoutes(app: express.Express) {
  app.get("/api/team-projects", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const projectKind = typeof req.query.projectKind === "string" ? req.query.projectKind : undefined;
      const projects = await prisma.productionProject.findMany({
        where: {
          ...projectKindWhere(projectKind),
          OR: [
            { members: { some: { userId: user.id } } },
            { roleGrants: { some: { userId: user.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } }
          ]
        },
        include: { _count: { select: { members: true } } },
        orderBy: { updatedAt: "desc" },
        take: 100
      });
      res.json({ success: true, projects: projects.map(serializeProject) });
    } catch (error) {
      sendApiError(res, error, "团队项目列表读取失败。");
    }
  });

  app.post("/api/team-projects", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const body = createProjectSchema.parse(req.body || {});
      const kind = body.projectKind || "TEAM";
      await ensureProjectNameAvailable({ createdById: user.id, name: body.name });
      const project = await prisma.productionProject.create({
        data: {
          name: body.name,
          description: body.description || null,
          createdById: user.id,
          metadata: {
            projectKind: kind,
            workflowType: body.workflowType || null
          },
          members: {
            create: {
              userId: user.id,
              role: ProductionProjectMemberRole.OWNER
            }
          }
        },
        include: { _count: { select: { members: true } } }
      });
      await writeAuditLog({ actor: user, action: AuditAction.CREATE, entityType: "ProductionProject", entityId: project.id, req, metadata: { operation: "create_project" } });
      res.status(201).json({ success: true, project: serializeProject(project) });
    } catch (error) {
      sendApiError(res, error, "团队项目创建失败。");
    }
  });

  app.patch("/api/team-projects/:projectId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      const body = updateProjectSchema.parse(req.body || {});
      const project = await prisma.productionProject.findUnique({
        where: { id: req.params.projectId },
        select: { createdById: true }
      });
      if (!project) throw new HttpError(404, "项目不存在。", "PROJECT_NOT_FOUND");
      await ensureProjectNameAvailable({ createdById: project.createdById || user.id, name: body.name, excludeProjectId: req.params.projectId });
      const updated = await prisma.productionProject.update({
        where: { id: req.params.projectId },
        data: { name: body.name }
      });
      res.json({ success: true, project: serializeProject(updated) });
    } catch (error) {
      sendApiError(res, error, "项目重命名失败。");
    }
  });

  app.delete("/api/team-projects/:projectId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      const project = await prisma.productionProject.findUnique({
        where: { id: req.params.projectId },
        include: {
          _count: { select: { members: true, roleGrants: true, assets: true } }
        }
      });
      if (!project) throw new HttpError(404, "项目不存在。", "PROJECT_NOT_FOUND");
      const deletedAt = new Date();
      const preservedAssets = await prisma.productionAsset.findMany({
        where: {
          projectId: req.params.projectId,
          scope: ProductionAssetScope.TEAM,
          reviewStatus: ProductionAssetReviewStatus.APPROVED,
          deletedAt: null
        },
        select: { id: true, metadata: true }
      });
      await prisma.$transaction(async (tx) => {
        for (const asset of preservedAssets) {
          const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata : {};
          await tx.productionAsset.update({
            where: { id: asset.id },
            data: {
              projectId: null,
              metadata: {
                ...metadata,
                deletedProject: {
                  id: project.id,
                  name: project.name,
                  deletedAt: deletedAt.toISOString()
                }
              }
            }
          });
        }
        await tx.productionAsset.deleteMany({
          where: {
            projectId: req.params.projectId,
            NOT: {
              id: { in: preservedAssets.map((asset) => asset.id) }
            }
          }
        });
        await tx.productionProject.delete({ where: { id: req.params.projectId } });
      });
      await writeAuditLog({
        actor: user,
        action: AuditAction.DELETE,
        entityType: "ProductionProject",
        entityId: req.params.projectId,
        req,
        metadata: {
          operation: "delete_project",
          memberCount: project._count.members,
          teamLeaderCount: project._count.roleGrants,
          assetCount: project._count.assets,
          preservedApprovedTeamAssetCount: preservedAssets.length
        }
      });
      res.json({ success: true, deleted: true, preservedApprovedTeamAssetCount: preservedAssets.length });
    } catch (error) {
      sendApiError(res, error, "项目删除失败。");
    }
  });

  app.get("/api/team-projects/:projectId/members", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectMemberStrict(req.params.projectId, user);
      const members = await prisma.productionProjectMember.findMany({
        where: { projectId: req.params.projectId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              displayName: true,
              role: true,
              status: true,
              productionProjectRoleGrants: {
                where: {
                  projectId: req.params.projectId,
                  role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
                }
              }
            }
          }
        },
        orderBy: { createdAt: "asc" }
      });
      res.json({ success: true, members: members.map(serializeMember) });
    } catch (error) {
      sendApiError(res, error, "项目成员读取失败。");
    }
  });

  app.get("/api/team-projects/:projectId/member-candidates", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      const query = searchUserSchema.parse(req.query || {});
      const users = await prisma.user.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { email: { contains: query.query, mode: "insensitive" } },
            { username: { contains: query.query, mode: "insensitive" } },
            { displayName: { contains: query.query, mode: "insensitive" } }
          ]
        },
        select: { id: true, email: true, username: true, displayName: true, role: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 20
      });
      res.json({ success: true, users });
    } catch (error) {
      sendApiError(res, error, "项目成员候选用户搜索失败。");
    }
  });

  app.post("/api/team-projects/:projectId/members", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      const body = addMemberSchema.parse(req.body || {});
      const target = await prisma.user.findUnique({ where: { id: body.userId } });
      if (!target) throw new HttpError(404, "用户不存在。", "USER_NOT_FOUND");
      if (body.role === ProductionProjectMemberRole.OWNER) {
        throw new HttpError(400, "不能通过成员添加接口设置项目拥有者。", "PROJECT_OWNER_ROLE_IMMUTABLE");
      }
      const member = await prisma.productionProjectMember.upsert({
        where: { projectId_userId: { projectId: req.params.projectId, userId: body.userId } },
        create: { projectId: req.params.projectId, userId: body.userId, role: body.role },
        update: { role: body.role },
        include: { user: true }
      });
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionProjectMember", entityId: member.id, req, metadata: { operation: "upsert_member", projectId: req.params.projectId, userId: body.userId, role: body.role } });
      res.status(201).json({ success: true, member: serializeMember(member) });
    } catch (error) {
      sendApiError(res, error, "项目成员保存失败。");
    }
  });

  app.post(["/api/team-projects/:projectId/team-leaders", "/api/team-projects/:projectId/developers"], async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      const body = grantDeveloperSchema.parse(req.body || {});
      const member = await prisma.productionProjectMember.findUnique({ where: { projectId_userId: { projectId: req.params.projectId, userId: body.userId } } });
      if (!member) throw new HttpError(400, "只能授权当前项目成员为制片。", "PROJECT_MEMBER_REQUIRED");
      if (member.role === ProductionProjectMemberRole.OWNER) {
        throw new HttpError(400, "项目拥有者无需额外制片权限。", "PROJECT_OWNER_TEAM_LEADER_GRANT_FORBIDDEN");
      }
      const currentLeaderCount = await teamLeaderCount(req.params.projectId);
      if (currentLeaderCount >= 2) {
        throw new HttpError(409, "每个项目最多只能有两名制片。请先进行制片身份对调。", "PROJECT_TEAM_LEADER_LIMIT_REACHED");
      }
      const now = new Date();
      const activeGrant = await prisma.productionProjectRoleGrant.findFirst({
        where: {
          projectId: req.params.projectId,
          userId: body.userId,
          role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        }
      });
      if (activeGrant) {
        res.status(200).json({ success: true, grant: activeGrant });
        return;
      }
      const grant = await prisma.productionProjectRoleGrant.create({
        data: {
          projectId: req.params.projectId,
          userId: body.userId,
          role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
          grantedById: user.id,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
        }
      });
      await notifyUsers({
        receiverIds: [body.userId],
        type: NotificationType.PROJECT_DEVELOPER_GRANTED,
        title: "你已被授权为制片",
        content: "你现在可以审核该项目的内部素材。",
        targetType: "ProductionProject",
        targetId: req.params.projectId,
        projectId: req.params.projectId
      });
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionProjectRoleGrant", entityId: grant.id, req, metadata: { operation: "grant_team_leader", projectId: req.params.projectId, userId: body.userId, expiresAt: body.expiresAt || null } });
      res.status(201).json({ success: true, grant });
    } catch (error) {
      sendApiError(res, error, "制片授权失败。");
    }
  });

  app.delete(["/api/team-projects/:projectId/team-leaders/:userId", "/api/team-projects/:projectId/developers/:userId"], async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      const updated = await prisma.productionProjectRoleGrant.updateMany({
        where: {
          projectId: req.params.projectId,
          userId: req.params.userId,
          role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      await notifyUsers({
        receiverIds: [req.params.userId],
        type: NotificationType.PROJECT_DEVELOPER_REVOKED,
        title: "制片权限已取消",
        content: "你已不再拥有该项目的素材审核权限。",
        targetType: "ProductionProject",
        targetId: req.params.projectId,
        projectId: req.params.projectId
      });
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionProjectRoleGrant", req, metadata: { operation: "revoke_team_leader", projectId: req.params.projectId, userId: req.params.userId, count: updated.count } });
      res.json({ success: true, revokedCount: updated.count });
    } catch (error) {
      sendApiError(res, error, "制片取消授权失败。");
    }
  });

  app.post("/api/team-projects/:projectId/team-leaders/swap", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const projectId = req.params.projectId;
      await ensureProjectManager(projectId, user);
      const body = swapTeamLeaderSchema.parse(req.body || {});
      if (body.fromUserId === body.toUserId) throw new HttpError(400, "请选择两个不同账号进行制片身份对调。", "TEAM_LEADER_SWAP_SAME_USER");
      const [fromMember, toMember, fromGrant, toGrant] = await Promise.all([
        prisma.productionProjectMember.findUnique({ where: { projectId_userId: { projectId, userId: body.fromUserId } } }),
        prisma.productionProjectMember.findUnique({ where: { projectId_userId: { projectId, userId: body.toUserId } } }),
        prisma.productionProjectRoleGrant.findFirst({
          where: {
            projectId,
            userId: body.fromUserId,
            role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
          }
        }),
        prisma.productionProjectRoleGrant.findFirst({
          where: {
            projectId,
            userId: body.toUserId,
            role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
          }
        })
      ]);
      if (!fromMember || !toMember) throw new HttpError(400, "对调账号必须都是当前项目成员。", "PROJECT_MEMBER_REQUIRED");
      if (fromMember.role === ProductionProjectMemberRole.OWNER) throw new HttpError(400, "项目拥有者不能通过对调撤销制片身份。", "PROJECT_OWNER_SWAP_FORBIDDEN");
      if (!fromGrant) throw new HttpError(400, "被换出的账号当前不是制片。", "TEAM_LEADER_SWAP_SOURCE_REQUIRED");
      if (toGrant || toMember.role === ProductionProjectMemberRole.OWNER) throw new HttpError(409, "被换入账号已经是制片。", "TEAM_LEADER_SWAP_TARGET_ALREADY_LEADER");
      const result = await prisma.$transaction(async (tx) => {
        await tx.productionProjectRoleGrant.update({
          where: { id: fromGrant.id },
          data: { revokedAt: new Date() }
        });
        return tx.productionProjectRoleGrant.create({
          data: {
            projectId,
            userId: body.toUserId,
            role: ProductionProjectGrantRole.PROJECT_DEVELOPER,
            grantedById: user.id,
            expiresAt: fromGrant.expiresAt || null
          }
        });
      });
      await notifyUsers({
        receiverIds: [body.fromUserId, body.toUserId],
        type: NotificationType.PROJECT_DEVELOPER_GRANTED,
        title: "制片身份已对调",
        content: "项目制片身份发生变更。",
        targetType: "ProductionProject",
        targetId: projectId,
        projectId
      });
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionProjectRoleGrant", entityId: result.id, req, metadata: { operation: "swap_team_leader", projectId, fromUserId: body.fromUserId, toUserId: body.toUserId } });
      res.json({ success: true, grant: result });
    } catch (error) {
      sendApiError(res, error, "制片身份对调失败。");
    }
  });

  app.delete("/api/team-projects/:projectId/members/:userId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await ensureProjectManager(req.params.projectId, user);
      if (user.id === req.params.userId) throw new HttpError(400, "不能将自己移出项目。", "PROJECT_MEMBER_SELF_REMOVE_FORBIDDEN");
      const target = await prisma.productionProjectMember.findUnique({
        where: { projectId_userId: { projectId: req.params.projectId, userId: req.params.userId } }
      });
      if (!target) throw new HttpError(404, "项目成员不存在。", "PROJECT_MEMBER_NOT_FOUND");
      if (target.role === ProductionProjectMemberRole.OWNER) throw new HttpError(400, "不能移除项目拥有者。", "PROJECT_OWNER_REMOVE_FORBIDDEN");
      const result = await prisma.$transaction(async (tx) => {
        const revoked = await tx.productionProjectRoleGrant.updateMany({
          where: {
            projectId: req.params.projectId,
            userId: req.params.userId,
            revokedAt: null
          },
          data: { revokedAt: new Date() }
        });
        await tx.productionProjectMember.delete({
          where: { projectId_userId: { projectId: req.params.projectId, userId: req.params.userId } }
        });
        return { revokedCount: revoked.count };
      });
      await writeAuditLog({ actor: user, action: AuditAction.DELETE, entityType: "ProductionProjectMember", entityId: target.id, req, metadata: { operation: "remove_member", projectId: req.params.projectId, userId: req.params.userId, revokedGrantCount: result.revokedCount } });
      res.json({ success: true, removed: true, ...result });
    } catch (error) {
      sendApiError(res, error, "项目成员移除失败。");
    }
  });

  app.get("/api/team-projects/:projectId/assets", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const projectId = req.params.projectId;
      const query = listProjectAssetsSchema.parse(req.query || {});
      await ensureProjectMemberStrict(projectId, user);
      const canManage = await hasProjectManagerAccess(projectId, user.id);

      if (query.view === "review" && canManage) {
        const snapshots = await prisma.productionAssetSnapshot.findMany({
          where: {
            ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
            asset: {
              projectId,
              deletedAt: null,
              scope: ProductionAssetScope.PERSONAL,
              ...(query.stage ? { stage: query.stage } : {}),
              ...(query.search ? { OR: assetTextFilter(query.search) } : {})
            }
          },
          include: snapshotInclude,
          orderBy: { createdAt: "desc" },
          take: 200
        });
        const items = snapshots.map((snapshot) => serializeInternalAssetItem({ kind: "snapshot", snapshot }));
        res.json({ success: true, mode: "review", canManage, items, snapshots: snapshots.map(serializeSnapshot) });
        return;
      }

      const teamAssets = await prisma.productionAsset.findMany({
        where: {
          projectId,
          scope: ProductionAssetScope.TEAM,
          reviewStatus: ProductionAssetReviewStatus.APPROVED,
          deletedAt: null,
          archivedAt: null,
          ...(query.stage ? { stage: query.stage } : {}),
          ...(query.search ? { OR: assetTextFilter(query.search) } : {})
        },
        include: assetInclude,
        orderBy: { updatedAt: "desc" },
        take: 200
      });
      const items = teamAssets.map((asset) => serializeInternalAssetItem({ kind: "reference", asset }));
      res.json({ success: true, mode: "team", canManage, items, assets: teamAssets.map(serializeAsset) });
    } catch (error) {
      sendApiError(res, error, "团队项目素材读取失败。");
    }
  });

  app.post("/api/team-projects/:projectId/assets/:snapshotId/approve", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const projectId = req.params.projectId;
      const body = reviewBodySchema.parse(req.body || {});
      await ensureProjectManager(projectId, user);
      const snapshot = await prisma.productionAssetSnapshot.findUnique({ where: { id: req.params.snapshotId }, include: { asset: true } });
      if (!snapshot || snapshot.asset.deletedAt || snapshot.asset.projectId !== projectId) throw new HttpError(404, "审核快照不存在。", "SNAPSHOT_NOT_FOUND");
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
            projectId,
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
            projectId,
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
        const reviewerName = await systemDisplayName(user.id);
        await notifyUsers({
          receiverIds: [snapshot.asset.submitterId],
          type: NotificationType.ASSET_APPROVED,
          title: "资产审核通过",
          content: [
            `你的文件「${snapshot.displayName}」已审核通过。`,
            `审核人：${reviewerName}`,
            `审核时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
            body.note ? `备注：${body.note}` : ""
          ].filter(Boolean).join("\n"),
          targetType: "ProductionAsset",
          targetId: snapshot.assetId,
          projectId,
          metadata: {
            action: "approve",
            assetId: snapshot.assetId,
            snapshotId: snapshot.id,
            reviewerId: user.id,
            reviewerName,
            note: body.note || null
          }
        });
      }
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionAssetReview", entityId: snapshot.id, req, metadata: { operation: "team_project_approve", assetId: snapshot.assetId, teamAssetId: result.teamAsset.id, projectId } });
      res.json({ success: true, snapshot: serializeSnapshot({ ...result.snapshot, asset: result.personalAsset }), asset: serializeAsset(result.personalAsset), teamAsset: serializeAsset(result.teamAsset) });
    } catch (error) {
      sendApiError(res, error, "团队素材审核通过失败。");
    }
  });

  app.post("/api/team-projects/:projectId/assets/:snapshotId/reject", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const projectId = req.params.projectId;
      const body = reviewBodySchema.parse(req.body || {});
      await ensureProjectManager(projectId, user);
      const snapshot = await prisma.productionAssetSnapshot.findUnique({ where: { id: req.params.snapshotId }, include: { asset: true } });
      if (!snapshot || snapshot.asset.deletedAt || snapshot.asset.projectId !== projectId) throw new HttpError(404, "审核快照不存在。", "SNAPSHOT_NOT_FOUND");
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
        const reviewerName = await systemDisplayName(user.id);
        await notifyUsers({
          receiverIds: [snapshot.asset.submitterId],
          type: NotificationType.ASSET_REJECTED,
          title: "资产审核未通过",
          content: [
            `你的文件「${snapshot.displayName}」未通过审核。`,
            `审核人：${reviewerName}`,
            `审核时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
            body.note ? `原因：${body.note}` : ""
          ].filter(Boolean).join("\n"),
          targetType: "ProductionAsset",
          targetId: snapshot.assetId,
          projectId,
          metadata: {
            action: "reject",
            assetId: snapshot.assetId,
            snapshotId: snapshot.id,
            reviewerId: user.id,
            reviewerName,
            note: body.note || null
          }
        });
      }
      await writeAuditLog({ actor: user, action: AuditAction.UPDATE, entityType: "ProductionAssetReview", entityId: snapshot.id, req, metadata: { operation: "team_project_reject", assetId: snapshot.assetId, projectId } });
      res.json({ success: true, snapshot: serializeSnapshot({ ...result.snapshot, asset: result.asset }), asset: serializeAsset(result.asset) });
    } catch (error) {
      sendApiError(res, error, "团队素材审核不通过失败。");
    }
  });
}
