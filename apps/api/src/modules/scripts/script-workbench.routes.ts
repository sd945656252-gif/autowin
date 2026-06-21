import fs from "fs";
import type express from "express";
import { AuditAction, MediaAssetType, MediaVisibility, ScriptProcessingJobType, UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { recordLocalMediaAsset } from "../media/media.service";
import { createLocalUpload, effectiveUploadMime, hasValidMagicNumber } from "../media/media.upload";
import { SCRIPT_BREAKDOWN_FIELDS } from "./script-breakdown.shared";
import { assertScriptUploadAccepted } from "./script-file-parser";
import { enqueueScriptProcessingJob, startScriptProcessingWorker } from "./script-processing.queue";
import { ensureProjectMemberStrict } from "../production-assets/production-assets.shared";
import {
  assertScriptProjectAccess,
  createIdeaProject,
  createScriptFileProject,
  createScriptJob,
  deleteScriptProject,
  processScriptJob,
  serializeScriptJob,
  serializeScriptProject,
  serializeScriptRow,
  updateScriptRow
} from "./script-workbench.service";

const scriptUpload = createLocalUpload(Number(process.env.SCRIPT_UPLOAD_MAX_MB || 20));

type ScriptRoutesOptions = {
  getAI?: () => unknown;
};

function uploadSingle(fieldName: string): express.RequestHandler {
  const middleware = scriptUpload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (error: any) => {
      if (error) {
        res.status(400).json({ success: false, error: error.message || "剧本文件上传失败。" });
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
    console.warn("[ScriptUpload] Failed to remove rejected upload:", error);
  }
}

function normalizeOriginalFilename(originalName: string) {
  if (!originalName) return originalName;
  if (/[ÃÂ]/.test(originalName)) {
    try {
      return Buffer.from(originalName, "latin1").toString("utf8");
    } catch {
      return originalName;
    }
  }
  return originalName;
}

async function requireScriptAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    await requireAuth(req);
    next();
  } catch (error: any) {
    res.status(error?.status || 401).json({ success: false, error: error?.status ? error.message : "Authentication is required." });
  }
}

async function enqueueOrRun(jobId: string, options: ScriptRoutesOptions) {
  const queued = await enqueueScriptProcessingJob(jobId);
  if (!queued) setTimeout(() => void processScriptJob(jobId, options).catch((error) => console.error("[ScriptJob] Inline processing failed:", error)), 0);
  return queued;
}

function productionProjectIdFrom(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || null;
}

export function registerScriptWorkbenchRoutes(app: express.Express, options: ScriptRoutesOptions) {
  app.get("/api/scripts/fields", (_req, res) => {
    res.json({ success: true, fields: SCRIPT_BREAKDOWN_FIELDS });
  });

  app.get("/api/scripts/projects", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const productionProjectId = productionProjectIdFrom(req.query.productionProjectId || req.query.projectId);
      if (productionProjectId) await ensureProjectMemberStrict(productionProjectId, user);
      const projects = await prisma.scriptProject.findMany({
        where: {
          ...(user.role === UserRole.ADMIN ? {} : { ownerId: user.id }),
          ...(productionProjectId ? { metadata: { path: ["productionProjectId"], equals: productionProjectId } } : {})
        },
        orderBy: { updatedAt: "desc" },
        take: 50
      });
      res.json({ success: true, projects: projects.map(serializeScriptProject) });
    } catch (error) {
      sendApiError(res, error, "剧本项目列表读取失败。");
    }
  });

  app.get("/api/scripts/projects/:projectId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await assertScriptProjectAccess(req.params.projectId, user);
      const project = await prisma.scriptProject.findUnique({
        where: { id: req.params.projectId },
        include: {
          rows: { orderBy: { orderIndex: "asc" } },
          versions: { orderBy: { version: "desc" }, take: 20 },
          jobs: { orderBy: { createdAt: "desc" }, take: 10 }
        }
      });
      res.json({ success: true, project: serializeScriptProject(project) });
    } catch (error) {
      sendApiError(res, error, "剧本项目读取失败。");
    }
  });

  app.delete("/api/scripts/projects/:projectId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const deleted = await deleteScriptProject({ user, projectId: req.params.projectId });
      res.json({ success: true, deleted });
    } catch (error) {
      sendApiError(res, error, "剧本项目删除失败。");
    }
  });

  app.post("/api/scripts/import", requireScriptAuth, uploadSingle("file"), async (req, res) => {
    try {
      const user = await requireAuth(req);
      const productionProjectId = productionProjectIdFrom(req.body?.productionProjectId || req.body?.projectId);
      if (productionProjectId) await ensureProjectMemberStrict(productionProjectId, user);
      if (!req.file) throw new HttpError(400, "请选择要上传的剧本文件。", "SCRIPT_FILE_REQUIRED");
      assertScriptUploadAccepted(req.file);
      const header = fs.readFileSync(req.file.path).subarray(0, 4096);
      const mimeType = effectiveUploadMime(req.file);
      if (!hasValidMagicNumber(header, mimeType)) throw new HttpError(400, "文件内容与声明类型不匹配。", "SCRIPT_FILE_MAGIC_MISMATCH");

      const originalName = normalizeOriginalFilename(req.file.originalname);
      const asset = await recordLocalMediaAsset({
        requestUser: user,
        type: MediaAssetType.DOCUMENT,
        url: `/uploads/${req.file.filename}`,
        filePath: req.file.path,
        originalName,
        mimeType,
        visibility: MediaVisibility.OWNER_ONLY,
        metadata: { purpose: "script-breakdown-source" }
      });
      const project = await createScriptFileProject({ user, fileAssetId: asset.id, title: String(req.body?.title || originalName || "上传剧本"), productionProjectId });
      const job = await createScriptJob({ ownerId: user.id, projectId: project.id, type: ScriptProcessingJobType.FILE_BREAKDOWN, inputJson: { sourceFileId: asset.id } });
      const queued = await enqueueOrRun(job.id, options);

      await writeAuditLog({ actor: user, action: AuditAction.CREATE, entityType: "ScriptProject", entityId: project.id, req, metadata: { operation: "upload_script_file", fileAssetId: asset.id, queued: Boolean(queued), mimeType, size: req.file.size } });
      res.status(201).json({ success: true, project: serializeScriptProject(project), job: serializeScriptJob(job), queued: Boolean(queued) });
    } catch (error) {
      deleteUploadedFile(req.file);
      sendApiError(res, error, "剧本文件上传或拆解任务创建失败。");
    }
  });

  app.post("/api/scripts/ideas", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const productionProjectId = productionProjectIdFrom(req.body?.productionProjectId || req.body?.projectId);
      if (productionProjectId) await ensureProjectMemberStrict(productionProjectId, user);
      const project = await createIdeaProject({ user, idea: String(req.body?.idea || ""), title: req.body?.title ? String(req.body.title) : undefined, productionProjectId });
      const job = await createScriptJob({ ownerId: user.id, projectId: project.id, type: ScriptProcessingJobType.IDEA_BREAKDOWN, inputJson: { ideaLength: project.originalIdea?.length || 0 } });
      const queued = await enqueueOrRun(job.id, options);
      await writeAuditLog({ actor: user, action: AuditAction.CREATE, entityType: "ScriptProject", entityId: project.id, req, metadata: { operation: "idea_breakdown", queued: Boolean(queued), ideaLength: project.originalIdea?.length || 0 } });
      res.status(201).json({ success: true, project: serializeScriptProject(project), job: serializeScriptJob(job), queued: Boolean(queued) });
    } catch (error) {
      sendApiError(res, error, "创意扩写任务创建失败。");
    }
  });

  app.get("/api/scripts/jobs/:jobId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const job = await prisma.scriptProcessingJob.findUnique({ where: { id: req.params.jobId } });
      if (!job || (user.role !== UserRole.ADMIN && job.ownerId !== user.id)) throw new HttpError(404, "任务不存在或无权访问。", "SCRIPT_JOB_NOT_FOUND");
      res.json({ success: true, job: serializeScriptJob(job) });
    } catch (error) {
      sendApiError(res, error, "剧本任务读取失败。");
    }
  });

  app.patch("/api/scripts/projects/:projectId/rows/:rowId", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const updated = await updateScriptRow({ user, projectId: req.params.projectId, rowId: req.params.rowId, body: req.body });
      res.json({ success: true, row: serializeScriptRow(updated) });
    } catch (error) {
      sendApiError(res, error, "分镜行保存失败。");
    }
  });

  app.post("/api/scripts/projects/:projectId/rows/:rowId/regenerate", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await assertScriptProjectAccess(req.params.projectId, user);
      const mode = req.body?.mode === "video" ? "video" : "image";
      const type = mode === "video" ? ScriptProcessingJobType.REGENERATE_VIDEO_PROMPT : ScriptProcessingJobType.REGENERATE_IMAGE_PROMPT;
      const job = await createScriptJob({ ownerId: user.id, projectId: req.params.projectId, type, inputJson: { rowId: req.params.rowId, mode } });
      const queued = await enqueueOrRun(job.id, options);
      res.status(202).json({ success: true, job: serializeScriptJob(job), queued: Boolean(queued) });
    } catch (error) {
      sendApiError(res, error, "提示词重新生成任务创建失败。");
    }
  });

  app.post("/api/scripts/projects/:projectId/regenerate", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await assertScriptProjectAccess(req.params.projectId, user);
      const mode = req.body?.mode === "image" || req.body?.mode === "video" ? req.body.mode : "both";
      const job = await createScriptJob({ ownerId: user.id, projectId: req.params.projectId, type: ScriptProcessingJobType.BULK_REGENERATE_PROMPTS, inputJson: { mode } });
      const queued = await enqueueOrRun(job.id, options);
      res.status(202).json({ success: true, job: serializeScriptJob(job), queued: Boolean(queued) });
    } catch (error) {
      sendApiError(res, error, "批量重新生成任务创建失败。");
    }
  });

  app.post("/api/scripts/projects/:projectId/export", async (req, res) => {
    try {
      const user = await requireAuth(req);
      await assertScriptProjectAccess(req.params.projectId, user);
      const job = await createScriptJob({ ownerId: user.id, projectId: req.params.projectId, type: ScriptProcessingJobType.EXPORT_EXCEL, inputJson: { format: "xlsx" } });
      const queued = await enqueueOrRun(job.id, options);
      res.status(202).json({ success: true, job: serializeScriptJob(job), queued: Boolean(queued) });
    } catch (error) {
      sendApiError(res, error, "Excel 导出任务创建失败。");
    }
  });
}

export function registerScriptProcessingWorker(options: ScriptRoutesOptions) {
  startScriptProcessingWorker((jobId) => processScriptJob(jobId, options), options);
}
