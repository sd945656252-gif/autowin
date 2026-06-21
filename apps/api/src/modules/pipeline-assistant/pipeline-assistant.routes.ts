import type express from "express";
import fs from "fs";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { createLocalUpload, effectiveUploadMime, hasValidMagicNumber } from "../media/media.upload";
import {
  confirmAssistantAction,
  createAssistantAttachment,
  createAssistantMessage,
  getAssistantContext,
  listAssistantMessages,
  parseStage,
  rejectAssistantAction
} from "./pipeline-assistant.service";

const assistantUpload = createLocalUpload(Number(process.env.PIPELINE_ASSISTANT_UPLOAD_MAX_MB || 25));

function uploadSingle(fieldName: string): express.RequestHandler {
  const middleware = assistantUpload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (error: any) => {
      if (error) {
        res.status(400).json({ success: false, error: error.message || "助手附件上传失败。" });
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
    console.warn("[PipelineAssistantUpload] Failed to remove uploaded file:", error);
  }
}

function normalizeProjectId(raw: string | undefined) {
  const value = String(raw || "").trim();
  if (!value || value === "guest" || value === "no-project") return null;
  return value;
}

function getProjectId(req: express.Request) {
  return normalizeProjectId(req.params.projectId || req.body?.projectId || req.query.projectId as string | undefined);
}

export function registerPipelineAssistantRoutes(app: express.Express) {
  app.get("/api/pipeline/:projectId/stages/:stage/assistant/context", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const stage = parseStage(req.params.stage);
      const context = await getAssistantContext({
        projectId: getProjectId(req),
        stage,
        user
      });
      res.json({ success: true, context });
    } catch (error) {
      sendApiError(res, error, "阶段助手上下文读取失败。");
    }
  });

  app.get("/api/pipeline/:projectId/stages/:stage/assistant/messages", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const stage = parseStage(req.params.stage);
      const messages = await listAssistantMessages({
        projectId: getProjectId(req),
        stage,
        user
      });
      res.json({ success: true, messages });
    } catch (error) {
      sendApiError(res, error, "阶段助手消息读取失败。");
    }
  });

  app.post("/api/pipeline/:projectId/stages/:stage/assistant/messages", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const stage = parseStage(req.params.stage);
      const text = typeof req.body?.text === "string"
        ? req.body.text
        : typeof req.body?.message === "string"
          ? req.body.message
          : "";
      if (!text.trim()) throw new HttpError(400, "Message text is required.", "PIPELINE_ASSISTANT_MESSAGE_REQUIRED");
      const result = await createAssistantMessage({
        projectId: getProjectId(req),
        stage,
        user,
        text,
        customModelId: typeof req.body?.customModelId === "string" ? req.body.customModelId : undefined,
        panel: typeof req.body?.panel === "string" ? req.body.panel : undefined,
        selection: req.body?.selection,
        req
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      sendApiError(res, error, "阶段助手响应生成失败。");
    }
  });

  app.post("/api/pipeline/:projectId/stages/:stage/assistant/attachments", uploadSingle("file"), async (req, res) => {
    try {
      const user = await requireAuth(req);
      const stage = parseStage(req.params.stage);
      if (!req.file) throw new HttpError(400, "请选择要上传的附件。", "PIPELINE_ASSISTANT_ATTACHMENT_REQUIRED");
      const mimeType = effectiveUploadMime(req.file);
      const header = fs.readFileSync(req.file.path).subarray(0, 4096);
      if (!hasValidMagicNumber(header, mimeType)) {
        throw new HttpError(400, "附件内容与声明类型不匹配。", "PIPELINE_ASSISTANT_ATTACHMENT_MAGIC_MISMATCH");
      }
      const result = await createAssistantAttachment({
        projectId: getProjectId(req),
        stage,
        user,
        file: { ...req.file, mimetype: mimeType },
        req
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      deleteUploadedFile(req.file);
      sendApiError(res, error, "阶段助手附件解析失败。");
    }
  });

  app.post("/api/pipeline/:projectId/stages/:stage/assistant/actions/:actionId/confirm", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const stage = parseStage(req.params.stage);
      const action = await confirmAssistantAction({
        projectId: getProjectId(req),
        stage,
        actionId: req.params.actionId,
        user,
        req
      });
      res.json({ success: true, action });
    } catch (error) {
      sendApiError(res, error, "阶段助手操作确认失败。");
    }
  });

  app.post("/api/pipeline/:projectId/stages/:stage/assistant/actions/:actionId/reject", async (req, res) => {
    try {
      const user = await requireAuth(req);
      const stage = parseStage(req.params.stage);
      const action = await rejectAssistantAction({
        projectId: getProjectId(req),
        stage,
        actionId: req.params.actionId,
        user,
        req
      });
      res.json({ success: true, action });
    } catch (error) {
      sendApiError(res, error, "阶段助手操作取消失败。");
    }
  });
}
