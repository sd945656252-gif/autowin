import type express from "express";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth } from "../auth/auth.shared";
import { ensureProjectMemberStrict } from "../production-assets/production-assets.shared";

const MAX_NODE_ID_LENGTH = 120;
const MAX_CHAT_MESSAGE_CHARS = Number(process.env.USER_DATA_CHAT_MESSAGE_MAX_CHARS || 20_000);
const MAX_PROMPT_TEXT_CHARS = Number(process.env.USER_DATA_PROMPT_TEXT_MAX_CHARS || 200_000);
const MAX_SAVED_PROMPT_CHARS = Number(process.env.USER_DATA_SAVED_PROMPT_MAX_CHARS || 200_000);
const MAX_PROMPT_ATTACHMENT_COUNT = Number(process.env.USER_DATA_PROMPT_ATTACHMENT_MAX_COUNT || 10);
const MAX_PROMPT_ATTACHMENT_BYTES = Number(process.env.USER_DATA_PROMPT_ATTACHMENT_MAX_BYTES || 3 * 1024 * 1024);
const MAX_PROMPT_ATTACHMENT_TOTAL_BYTES = Number(process.env.USER_DATA_PROMPT_ATTACHMENT_TOTAL_MAX_BYTES || 10 * 1024 * 1024);
const MAX_CANVAS_STATE_BYTES = Number(process.env.USER_DATA_CANVAS_STATE_MAX_BYTES || 2 * 1024 * 1024);
const PROMPT_HISTORY_RETENTION_DAYS = Number(process.env.USER_DATA_PROMPT_HISTORY_RETENTION_DAYS || 30);
const SENSITIVE_USER_DATA_KEYS = /(^|[_-])(api[_-]?key|custom[_-]?key|authorization|bearer|token|secret|password)($|[_-])/i;
const REDACTED_USER_DATA_SECRET = "[REDACTED]";

function serializePromptHistoryItem(item: any) {
  return {
    id: item.id,
    timestamp: item.createdAt?.toISOString?.() || item.createdAt,
    featureMode: item.featureMode,
    input: item.input,
    output: item.output,
    attachments: (item.attachments || []).map((attachment: any) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: attachment.data
    })),
    model: item.model,
    mode: item.mode || undefined,
    duration: item.duration || undefined,
    techniques: item.techniques || undefined,
    styles: item.styles || undefined,
    promptCount: item.promptCount || undefined,
    projectId: item.metadata?.projectId || undefined,
    projectTitle: item.metadata?.projectTitle || undefined,
    outputType: item.metadata?.outputType || undefined,
    source: item.metadata?.source || undefined,
    ...((item.metadata as Record<string, any>) || {})
  };
}

function serializeSavedPrompt(item: any) {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    timestamp: item.createdAt?.toISOString?.() || item.createdAt
  };
}

function defaultCanvasState() {
  return { nodes: [], shotNodes: [], shots: [], apiConfigs: [], activeStage: "02" };
}

function limitedString(value: unknown, fieldName: string, maxChars: number) {
  const text = String(value || "");
  if (text.length > maxChars) {
    throw new HttpError(413, `${fieldName} is too large.`);
  }
  return text;
}

function byteLength(value: unknown) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value || null), "utf8");
}

function redactSensitiveUserData(value: any): any {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveUserData(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
    if (SENSITIVE_USER_DATA_KEYS.test(key)) {
      return [key, nestedValue ? REDACTED_USER_DATA_SECRET : nestedValue];
    }
    return [key, redactSensitiveUserData(nestedValue)];
  }));
}

function sanitizePromptAttachments(rawAttachments: unknown) {
  const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];
  if (attachments.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new HttpError(413, "Too many prompt history attachments.");
  }

  let totalBytes = 0;
  return attachments.map((attachment: any) => {
    const data = String(attachment?.data || "");
    const sizeBytes = byteLength(data);
    totalBytes += sizeBytes;
    if (sizeBytes > MAX_PROMPT_ATTACHMENT_BYTES) {
      throw new HttpError(413, "Prompt history attachment is too large.");
    }
    if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
      throw new HttpError(413, "Prompt history attachments are too large.");
    }
    return {
      name: String(attachment?.name || "attachment").slice(0, 180),
      mimeType: String(attachment?.mimeType || "application/octet-stream").slice(0, 120),
      data,
      sizeBytes
    };
  });
}

function sanitizeCanvasStatePayload(state: any) {
  if (!state || typeof state !== "object") {
    throw new HttpError(400, "Canvas state is required.");
  }

  const activeStage = typeof state.activeStage === "string" && /^0[2-6]$/.test(state.activeStage)
    ? state.activeStage
    : "02";

  const cleanState = redactSensitiveUserData({
    nodes: Array.isArray(state.nodes) ? state.nodes : [],
    shotNodes: Array.isArray(state.shotNodes) ? state.shotNodes : [],
    shots: Array.isArray(state.shots) ? state.shots : [],
    apiConfigs: [],
    activeStage,
    metadata: state.metadata && typeof state.metadata === "object" && !Array.isArray(state.metadata) ? state.metadata : {}
  });
  if (byteLength(cleanState) > MAX_CANVAS_STATE_BYTES) {
    throw new HttpError(413, "Canvas state is too large.");
  }
  return cleanState;
}

function canvasWorkflowName(userId: string, projectId?: string | null) {
  return projectId ? `canvas-state:${userId || "guest"}:${projectId}` : `canvas-state:${userId || "guest"}`;
}

function canvasWorkflowDescription(userId: string, projectId?: string | null) {
  return projectId ? `Canvas state for ${userId} in project ${projectId}` : `Canvas state for ${userId}`;
}

function scopedChatNodeId(nodeId: string, projectId?: string | null) {
  const safeNodeId = nodeId.slice(0, MAX_NODE_ID_LENGTH);
  if (!projectId) return safeNodeId;
  return `${projectId}:${safeNodeId}`.slice(0, MAX_NODE_ID_LENGTH);
}

async function cleanupPromptHistoryRetention(ownerId: string) {
  if (!PROMPT_HISTORY_RETENTION_DAYS || PROMPT_HISTORY_RETENTION_DAYS <= 0) return;
  const retentionCutoff = new Date(Date.now() - PROMPT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.promptHistoryItem.deleteMany({
    where: {
      ownerId,
      createdAt: { lt: retentionCutoff }
    }
  });
}

export function registerUserDataRoutes(app: express.Express) {
  app.get("/api/chat", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const userId = requestUser.id;
      const nodeId = typeof req.query.nodeId === "string"
        ? req.query.nodeId
        : typeof req.query.stageId === "string"
          ? req.query.stageId
          : "global";
      const projectId = typeof req.query.projectId === "string" && req.query.projectId.trim() ? req.query.projectId.trim() : null;
      if (projectId) await ensureProjectMemberStrict(projectId, requestUser);
      const safeNodeId = scopedChatNodeId(nodeId, projectId);

      const records = await prisma.chatMessage.findMany({
        where: { userId, nodeId: safeNodeId },
        orderBy: { createdAt: "asc" },
        take: 200
      });

      const messages = records.map((item) => ({
        id: item.id,
        sender: item.role === "assistant" || item.role === "ai" ? "ai" : "user",
        role: item.role,
        text: item.text,
        timestamp: item.createdAt.toISOString(),
        createdAt: item.createdAt.toISOString()
      }));

      res.json({ success: true, messages });
    } catch (error: any) {
      console.error("[Chat] Failed to fetch chat messages:", error);
      sendApiError(res, error, "Failed to fetch chat messages.");
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const userId = requestUser.id;
      const projectId = typeof req.body?.projectId === "string" && req.body.projectId.trim() ? req.body.projectId.trim() : null;
      if (projectId) await ensureProjectMemberStrict(projectId, requestUser);
      const nodeId = scopedChatNodeId(String(req.body?.nodeId || req.body?.stageId || "global"), projectId);
      const messageText = typeof req.body?.text === "string"
        ? req.body.text
        : typeof req.body?.content === "string"
          ? req.body.content
          : typeof req.body?.message === "string"
            ? req.body.message
            : "";

      if (!messageText.trim()) {
        res.status(400).json({ success: false, error: "Chat message text is required." });
        return;
      }
      const cleanMessageText = limitedString(messageText.trim(), "Chat message text", MAX_CHAT_MESSAGE_CHARS);

      const role = req.body?.role === "assistant" || req.body?.sender === "ai" ? "assistant" : "user";
      const saved = await prisma.chatMessage.create({
        data: {
          userId,
          nodeId,
          role,
          text: cleanMessageText
        }
      });

      const responseText = role === "user"
        ? "Saved to PostgreSQL. AI chat generation is pending backend module migration."
        : saved.text;

      res.json({
        success: true,
        text: responseText,
        message: {
          id: saved.id,
          sender: saved.role === "assistant" ? "ai" : "user",
          role: saved.role,
          text: saved.text,
          timestamp: saved.createdAt.toISOString(),
          createdAt: saved.createdAt.toISOString()
        }
      });
    } catch (error: any) {
      console.error("[Chat] Failed to save chat message:", error);
      sendApiError(res, error, "Failed to save chat message.");
    }
  });

  app.get("/api/prompt-history", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const ownerId = requestUser.id;
      await cleanupPromptHistoryRetention(ownerId);
      const items = await prisma.promptHistoryItem.findMany({
        where: { ownerId },
        orderBy: { createdAt: "desc" },
        include: { attachments: { orderBy: { createdAt: "asc" } } }
      });
      res.json({ success: true, items: items.map(serializePromptHistoryItem) });
    } catch (error: any) {
      console.error("[PromptHistory] Failed to list history:", error);
      sendApiError(res, error, "Failed to list prompt history.");
    }
  });

  app.post("/api/prompt-history", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const ownerId = requestUser.id;
      const attachments = sanitizePromptAttachments(req.body?.attachments);
      const metadata = {
        wordCount: req.body?.wordCount ?? null,
        imagePromptGear: req.body?.imagePromptGear ?? null,
        projectId: typeof req.body?.projectId === "string" ? req.body.projectId : null,
        projectTitle: typeof req.body?.projectTitle === "string" ? req.body.projectTitle : null,
        outputType: typeof req.body?.outputType === "string" ? req.body.outputType : null,
        source: typeof req.body?.source === "string" ? req.body.source : null
      };

      const item = await prisma.promptHistoryItem.create({
        data: {
          ownerId,
          featureMode: String(req.body?.featureMode || "prompt"),
          input: limitedString(req.body?.input || "", "Prompt history input", MAX_PROMPT_TEXT_CHARS),
          output: limitedString(req.body?.output || "", "Prompt history output", MAX_PROMPT_TEXT_CHARS),
          model: String(req.body?.model || "").slice(0, 120),
          mode: req.body?.mode ? String(req.body.mode).slice(0, 80) : undefined,
          duration: req.body?.duration ? String(req.body.duration).slice(0, 80) : undefined,
          techniques: req.body?.techniques ?? undefined,
          styles: req.body?.styles ?? undefined,
          promptCount: Number.isFinite(Number(req.body?.promptCount)) ? Number(req.body.promptCount) : undefined,
          metadata,
          attachments: {
            create: attachments
          }
        },
        include: { attachments: { orderBy: { createdAt: "asc" } } }
      });

      res.json({ success: true, item: serializePromptHistoryItem(item) });
    } catch (error: any) {
      console.error("[PromptHistory] Failed to save history:", error);
      sendApiError(res, error, "Failed to save prompt history.");
    }
  });

  app.delete("/api/prompt-history/:id", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const deleted = await prisma.promptHistoryItem.deleteMany({
        where: { id: req.params.id, ownerId: requestUser.id }
      });
      if (deleted.count === 0) {
        res.status(404).json({ success: false, error: "Prompt history item not found." });
        return;
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("[PromptHistory] Failed to delete history item:", error);
      sendApiError(res, error, "Failed to delete prompt history item.");
    }
  });

  app.delete("/api/prompt-history", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      await prisma.promptHistoryItem.deleteMany({ where: { ownerId: requestUser.id } });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[PromptHistory] Failed to clear history:", error);
      sendApiError(res, error, "Failed to clear prompt history.");
    }
  });

  app.get("/api/saved-prompts", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const items = await prisma.savedPrompt.findMany({
        where: { ownerId: requestUser.id },
        orderBy: { createdAt: "desc" },
        take: 200
      });
      res.json({ success: true, prompts: items.map(serializeSavedPrompt) });
    } catch (error: any) {
      console.error("[SavedPrompt] Failed to list prompts:", error);
      sendApiError(res, error, "Failed to list saved prompts.");
    }
  });

  app.post("/api/saved-prompts", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const title = String(req.body?.title || "").trim().slice(0, 180);
      const content = limitedString(String(req.body?.content || "").trim(), "Saved prompt content", MAX_SAVED_PROMPT_CHARS);
      if (!title || !content) {
        res.status(400).json({ success: false, error: "title and content are required." });
        return;
      }

      const item = await prisma.savedPrompt.create({
        data: { ownerId: requestUser.id, title, content }
      });
      res.json({ success: true, prompt: serializeSavedPrompt(item) });
    } catch (error: any) {
      console.error("[SavedPrompt] Failed to save prompt:", error);
      sendApiError(res, error, "Failed to save prompt.");
    }
  });

  app.delete("/api/saved-prompts/:id", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const deleted = await prisma.savedPrompt.deleteMany({
        where: { id: req.params.id, ownerId: requestUser.id }
      });
      if (deleted.count === 0) {
        res.status(404).json({ success: false, error: "Saved prompt not found." });
        return;
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("[SavedPrompt] Failed to delete prompt:", error);
      sendApiError(res, error, "Failed to delete saved prompt.");
    }
  });

  app.get("/api/canvas-state", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const userId = requestUser.id;
      const projectId = typeof req.query.projectId === "string" && req.query.projectId.trim() ? req.query.projectId.trim() : null;
      if (projectId) await ensureProjectMemberStrict(projectId, requestUser);
      let workflow = await prisma.workflow.findFirst({
        where: { ownerId: userId, name: canvasWorkflowName(userId, projectId) },
        orderBy: { updatedAt: "desc" },
        include: {
          versions: {
            where: { version: 1 },
            take: 1
          }
        }
      });

      if (!workflow) {
        const legacyWorkflow = await prisma.workflow.findFirst({
          where: { ownerId: null, name: canvasWorkflowName(userId, projectId) },
          orderBy: { updatedAt: "desc" }
        });
        if (legacyWorkflow) {
          workflow = await prisma.workflow.update({
            where: { id: legacyWorkflow.id },
            data: { ownerId: userId, description: canvasWorkflowDescription(userId, projectId) },
            include: {
              versions: {
                where: { version: 1 },
                take: 1
              }
            }
          });
        }
      }

      const state = workflow?.versions?.[0]?.reactFlowJson || defaultCanvasState();
      res.json({ success: true, state, workflowId: workflow?.id || null });
    } catch (error: any) {
      console.error("[CanvasState] Failed to fetch canvas state:", error);
      sendApiError(res, error, "Failed to fetch canvas state.");
    }
  });

  app.post("/api/canvas-state", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const userId = requestUser.id;
      const projectId = typeof req.body?.projectId === "string" && req.body.projectId.trim() ? req.body.projectId.trim() : null;
      if (projectId) await ensureProjectMemberStrict(projectId, requestUser);
      const state = req.body?.state;
      const cleanState = sanitizeCanvasStatePayload(state);

      let workflow = await prisma.workflow.findFirst({
        where: { ownerId: userId, name: canvasWorkflowName(userId, projectId) },
        orderBy: { updatedAt: "desc" }
      });

      if (!workflow) {
        const legacyWorkflow = await prisma.workflow.findFirst({
          where: { ownerId: null, name: canvasWorkflowName(userId, projectId) },
          orderBy: { updatedAt: "desc" }
        });
        if (legacyWorkflow) {
          workflow = await prisma.workflow.update({
            where: { id: legacyWorkflow.id },
            data: { ownerId: userId, description: canvasWorkflowDescription(userId, projectId) }
          });
        }
      }

      if (!workflow) {
        workflow = await prisma.workflow.create({
          data: {
            ownerId: userId,
            name: canvasWorkflowName(userId, projectId),
            description: canvasWorkflowDescription(userId, projectId)
          }
        });
      } else {
        workflow = await prisma.workflow.update({
          where: { id: workflow.id },
          data: { description: canvasWorkflowDescription(userId, projectId) }
        });
      }

      await prisma.workflowVersion.upsert({
        where: {
          workflowId_version: {
            workflowId: workflow.id,
            version: 1
          }
        },
        create: {
          workflowId: workflow.id,
          version: 1,
          schemaJson: {
            version: 1,
            nodes: cleanState.nodes,
            edges: [],
            metadata: {
              kind: "canvas_state",
              userId,
              projectId
            }
          },
          reactFlowJson: cleanState
        },
        update: {
          schemaJson: {
            version: 1,
            nodes: cleanState.nodes,
            edges: [],
            metadata: {
              kind: "canvas_state",
              userId,
              projectId
            }
          },
          reactFlowJson: cleanState
        }
      });

      res.json({ success: true, state: cleanState });
    } catch (error: any) {
      console.error("[CanvasState] Failed to save canvas state:", error);
      sendApiError(res, error, "Failed to save canvas state.");
    }
  });
}
