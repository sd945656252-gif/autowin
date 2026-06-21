import type express from "express";
import { WorkflowRunStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { requireAuth } from "../auth/auth.shared";
import { sendApiError } from "../../shared/http";
import { getWorkflowTaskForOwner, getWorkflowTaskRunLinkForOwner, evictExpiredWorkflowTasks } from "./workflow-task.store";

const QUEUED_STALE_MS = Number(process.env.WORKFLOW_QUEUED_STALE_SECONDS || 300) * 1000;

function runStatusToTask(run: { status: WorkflowRunStatus; error?: string | null; outputJson?: any; createdAt?: Date | string | null }) {
  const output = run.outputJson && typeof run.outputJson === "object" ? run.outputJson : {};
  if (run.status === WorkflowRunStatus.SUCCEEDED) {
    return {
      progress: 100,
      status: "Generation completed",
      media_data: output.mediaData || output.media_data,
      output_text: output.outputText || output.output_text,
      completed: true
    };
  }
  if (run.status === WorkflowRunStatus.FAILED || run.status === WorkflowRunStatus.CANCELED) {
    return {
      progress: 100,
      status: run.status === WorkflowRunStatus.CANCELED ? "Execution canceled" : "Execution failed",
      error: run.error || "Workflow execution failed.",
      completed: true
    };
  }
  if (run.status === WorkflowRunStatus.RUNNING) {
    return { progress: 10, status: "Workflow running", completed: false };
  }
  const createdAtMs = run.createdAt ? new Date(run.createdAt).getTime() : 0;
  const queuedMs = createdAtMs ? Date.now() - createdAtMs : 0;
  if (queuedMs > QUEUED_STALE_MS) {
    return {
      progress: 100,
      status: "Workflow queue timeout",
      error: "任务长时间停留在队列中，后台 worker 可能未消费任务或已重启。请稍后重新运行该节点。",
      completed: true
    };
  }
  return { progress: 1, status: "Workflow queued, waiting for worker", completed: false };
}

export function registerWorkflowTaskRoutes(app: express.Express) {
  setInterval(() => {
    evictExpiredWorkflowTasks();
  }, 3600000);

  app.get("/api/workflow/status/:task_id", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const task = await getWorkflowTaskForOwner(req.params.task_id, requestUser.id);
      if (task?.runId) {
        const run = await prisma.workflowRun.findFirst({
          where: { id: task.runId, ownerId: requestUser.id },
          select: { status: true, error: true, outputJson: true, createdAt: true }
        });
        if (run?.status !== WorkflowRunStatus.RUNNING && run?.status !== WorkflowRunStatus.QUEUED) {
          res.json(runStatusToTask(run));
          return;
        }
        if (run?.status === WorkflowRunStatus.QUEUED) {
          const recovered = runStatusToTask(run);
          if (recovered.completed || task.progress <= 0) {
            res.json(recovered);
            return;
          }
        }
      }
      if (!task) {
        const link = await getWorkflowTaskRunLinkForOwner(req.params.task_id, requestUser.id);
        if (link) {
          const run = await prisma.workflowRun.findFirst({
            where: { id: link.runId, ownerId: requestUser.id },
            select: { status: true, error: true, outputJson: true, createdAt: true }
          });
          if (run) {
            res.json(runStatusToTask(run));
            return;
          }
        }
        res.status(404).json({ error: "Task not found or expired." });
        return;
      }
      const { ownerId: _ownerId, ...publicTask } = task;
      res.json(publicTask);
    } catch (error: any) {
      sendApiError(res, error, "Failed to fetch workflow task status.");
    }
  });
}
