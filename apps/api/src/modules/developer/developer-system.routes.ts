import fs from "fs";
import path from "path";
import type express from "express";
import { AuditAction, UserRole, WorkflowRunStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getRedisConnection, getRedisUrl } from "../../queue/redis";
import { sendApiError } from "../../shared/http";
import { requireRoles } from "../auth/auth.shared";
import { checkShowcaseFfmpegAvailability, isShowcaseTranscodeEnabled } from "../video-registry/video-registry.service";
import { getWorkflowExecutionQueue } from "../workflow/workflow-execute.queue";

const startedAt = new Date();

function truncateText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value : "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeWorkflowRunInput(input: any) {
  if (!input || typeof input !== "object") return undefined;
  return {
    node_id: input.node_id === "security-inline-key-test" ? input.node_id : undefined,
    node_type: typeof input.node_type === "string" ? input.node_type : undefined,
    prompt: truncateText(input.prompt, 120) || undefined,
    custom_config_id: typeof input.custom_config_id === "string" ? input.custom_config_id : undefined,
    selected_api_id: typeof input.selected_api_id === "string" ? input.selected_api_id : undefined,
    custom_model: typeof input.custom_model === "string" ? input.custom_model : undefined,
    workflow_id: typeof input.workflow_id === "string" ? input.workflow_id : undefined,
    workflow_version_id: typeof input.workflow_version_id === "string" ? input.workflow_version_id : undefined,
    hasImageInputs: Boolean(input.image_inputs || input.images?.length || input.uploaded_images?.length),
    hasVideoInputs: Boolean(input.video_inputs || input.video_media_list?.length)
  };
}

function summarizeWorkflowRun(run: any) {
  return {
    ...run,
    inputJson: summarizeWorkflowRunInput(run.inputJson),
    outputJson: run.outputJson ? {
      taskId: typeof run.outputJson.taskId === "string" ? run.outputJson.taskId : undefined,
      mode: typeof run.outputJson.mode === "string" ? run.outputJson.mode : null,
      canonicalModelId: typeof run.outputJson.canonicalModelId === "string" ? run.outputJson.canonicalModelId : null,
      hasOutput: true
    } : null,
    error: truncateText(run.error, 500) || null
  };
}

function readPackageVersion() {
  try {
    const packagePath = path.join(process.cwd(), "package.json");
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return String(parsed.version || "unknown");
  } catch {
    return "unknown";
  }
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error: any) {
    return { status: "unavailable", error: error?.message || "Database check failed." };
  }
}

async function checkRedis() {
  if (!getRedisUrl()) return { status: "not_configured" };
  try {
    const redis = getRedisConnection();
    if (!redis) return { status: "not_configured" };
    await redis.connect().catch((error: any) => {
      if (!String(error?.message || "").includes("already connecting") && !String(error?.message || "").includes("Connection is already")) {
        throw error;
      }
    });
    const pong = await redis.ping();
    return { status: pong === "PONG" ? "ok" : "unknown", response: pong };
  } catch (error: any) {
    return { status: "unavailable", error: error?.message || "Redis check failed." };
  }
}

async function getQueueStatus() {
  try {
    const queue = getWorkflowExecutionQueue();
    if (!queue) return { status: "not_configured" };
    const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
    return { status: "ok", counts };
  } catch (error: any) {
    return { status: "unavailable", error: error?.message || "Queue status unavailable." };
  }
}

export function registerDeveloperSystemRoutes(app: express.Express) {
  app.get("/api/developer/system/health", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const [database, redis, workflowStats] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        prisma.workflowRun.groupBy({ by: ["status"], _count: { status: true } }).catch(() => [])
      ]);
      const ffmpeg = await checkShowcaseFfmpegAvailability();
      res.json({
        success: true,
        service: { status: "ok", startedAt: startedAt.toISOString(), uptimeSeconds: Math.round(process.uptime()) },
        database,
        redis,
        showcaseTranscode: {
          enabled: isShowcaseTranscodeEnabled(),
          ffmpegAvailable: ffmpeg.available,
          ffmpeg: ffmpeg.ffmpeg,
          ffprobe: ffmpeg.ffprobe,
          status: isShowcaseTranscodeEnabled() ? (ffmpeg.available ? "ready" : "misconfigured") : "disabled",
          error: ffmpeg.error || null
        },
        environment: process.env.NODE_ENV || "development",
        version: readPackageVersion(),
        workflowStats: Object.fromEntries(workflowStats.map((item: any) => [item.status, item._count.status]))
      });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load developer system health.");
    }
  });

  app.get("/api/developer/system/workflow-runs", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const runs = await prisma.workflowRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          workflowId: true,
          versionId: true,
          status: true,
          error: true,
          inputJson: true,
          outputJson: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          workflow: { select: { name: true } }
        }
      });
      const stats = await prisma.workflowRun.groupBy({ by: ["status"], _count: { status: true } });
      res.json({ success: true, runs: runs.map(summarizeWorkflowRun), stats: Object.fromEntries(stats.map((item) => [item.status, item._count.status])) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load workflow runs.");
    }
  });

  app.get("/api/developer/system/queue", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const queue = await getQueueStatus();
      res.json({ success: true, queue });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load workflow queue status.");
    }
  });

  app.get("/api/developer/system/errors", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const [failedRuns, auditEvents] = await Promise.all([
        prisma.workflowRun.findMany({
          where: { status: WorkflowRunStatus.FAILED },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            error: true,
            createdAt: true,
            workflowId: true,
            inputJson: true,
            workflow: { select: { name: true } }
          }
        }),
        prisma.auditLog.findMany({
          where: {
            OR: [
              { action: AuditAction.ACCESS, metadata: { path: ["decision"], equals: "denied" } },
              { entityType: { contains: "Error", mode: "insensitive" } }
            ]
          },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: { id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true }
        }).catch(() => [])
      ]);
      res.json({ success: true, failedRuns: failedRuns.map(summarizeWorkflowRun), auditEvents });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load recent errors.");
    }
  });
}
