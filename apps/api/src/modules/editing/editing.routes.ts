import type express from "express";
import { sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { ensureProjectMemberStrict } from "../production-assets/production-assets.shared";
import { assertEditingProjectAccess, createEditingProject, listEditingAssets, listEditingProjects, saveEditingTimeline, serializeEditingProject } from "./editing.service";

function productionProjectIdFrom(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || null;
}

export function registerEditingRoutes(app: express.Express) {
  app.get("/api/editing-projects", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const productionProjectId = productionProjectIdFrom(req.query.productionProjectId || req.query.projectId);
      if (productionProjectId) await ensureProjectMemberStrict(productionProjectId, user);
      const projects = await listEditingProjects(user, productionProjectId);
      res.json({ success: true, projects });
    } catch (error) {
      sendApiError(res, error, "剪辑工程列表读取失败。");
    }
  });

  app.post("/api/editing-projects", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const productionProjectId = productionProjectIdFrom(req.body?.productionProjectId || req.body?.projectId);
      if (productionProjectId) await ensureProjectMemberStrict(productionProjectId, user);
      const project = await createEditingProject({ user, title: req.body?.title ? String(req.body.title) : undefined, productionProjectId });
      res.status(201).json({ success: true, project });
    } catch (error) {
      sendApiError(res, error, "剪辑工程创建失败。");
    }
  });

  app.get("/api/editing-projects/:id", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const project = await assertEditingProjectAccess(req.params.id, user);
      res.json({ success: true, project: serializeEditingProject(project) });
    } catch (error) {
      sendApiError(res, error, "剪辑工程读取失败。");
    }
  });

  app.put("/api/editing-projects/:id/timeline", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const project = await saveEditingTimeline({ user, projectId: req.params.id, timeline: req.body?.timeline });
      res.json({ success: true, project });
    } catch (error) {
      sendApiError(res, error, "剪辑时间线保存失败。");
    }
  });

  app.get("/api/editing-projects/:id/assets", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const project = await assertEditingProjectAccess(req.params.id, user);
      const assets = await listEditingAssets({ user, project });
      res.json({ success: true, assets });
    } catch (error) {
      sendApiError(res, error, "剪辑素材读取失败。");
    }
  });
}
