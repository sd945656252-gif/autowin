import { getRedisConnection } from "../../queue/redis";

export type WorkflowTaskStatus = {
  ownerId: string;
  runId?: string;
  progress: number;
  status: string;
  media_data?: string;
  output_text?: string;
  error?: string;
  completed: boolean;
};

export type WorkflowTaskRunLink = {
  ownerId: string;
  runId: string;
};

const tasks = new Map<string, WorkflowTaskStatus>();
const runLinks = new Map<string, WorkflowTaskRunLink>();
const WORKFLOW_TASK_TTL_SECONDS = Number(process.env.WORKFLOW_TASK_TTL_SECONDS || 3600);
const taskCreatedAt = new Map<string, number>();

function taskKey(taskId: string) {
  return `workflow-task:${taskId}`;
}

function taskRunKey(taskId: string) {
  return `workflow-task-run:${taskId}`;
}

export async function setWorkflowTask(taskId: string, status: WorkflowTaskStatus) {
  const existing = tasks.get(taskId);
  const merged = existing?.runId && !status.runId ? { ...status, runId: existing.runId } : status;
  tasks.set(taskId, merged);
  taskCreatedAt.set(taskId, taskCreatedAt.get(taskId) ?? Date.now());
  const redis = getRedisConnection();
  if (!redis) return;
  await redis.set(taskKey(taskId), JSON.stringify(merged), "EX", WORKFLOW_TASK_TTL_SECONDS).catch((error) => {
    console.warn("[WorkflowTask] Failed to persist task status to Redis:", error?.message || error);
  });
}

export async function setWorkflowTaskRunLink(taskId: string, link: WorkflowTaskRunLink) {
  runLinks.set(taskId, link);
  const redis = getRedisConnection();
  if (!redis) return;
  await redis.set(taskRunKey(taskId), JSON.stringify(link), "EX", WORKFLOW_TASK_TTL_SECONDS).catch((error) => {
    console.warn("[WorkflowTask] Failed to persist task run link to Redis:", error?.message || error);
  });
}

export function getWorkflowTask(taskId: string) {
  return tasks.get(taskId);
}

export async function getWorkflowTaskForOwner(taskId: string, ownerId: string) {
  let task = tasks.get(taskId) || null;
  if (!task) {
    const redis = getRedisConnection();
    const raw = redis ? await redis.get(taskKey(taskId)).catch(() => null) : null;
    if (raw) {
      try {
        task = JSON.parse(raw) as WorkflowTaskStatus;
        tasks.set(taskId, task);
      } catch {
        task = null;
      }
    }
  }
  if (!task || task.ownerId !== ownerId) return null;
  return task;
}

export async function getWorkflowTaskRunLinkForOwner(taskId: string, ownerId: string) {
  let link = runLinks.get(taskId) || null;
  if (!link) {
    const redis = getRedisConnection();
    const raw = redis ? await redis.get(taskRunKey(taskId)).catch(() => null) : null;
    if (raw) {
      try {
        link = JSON.parse(raw) as WorkflowTaskRunLink;
        runLinks.set(taskId, link);
      } catch {
        link = null;
      }
    }
  }
  if (!link || link.ownerId !== ownerId) return null;
  return link;
}

export function clearWorkflowTasks() {
  tasks.clear();
  runLinks.clear();
  taskCreatedAt.clear();
}

export function getWorkflowTaskCount() {
  return tasks.size;
}

export function evictExpiredWorkflowTasks() {
  const cutoff = Date.now() - WORKFLOW_TASK_TTL_SECONDS * 1000;
  for (const [id, createdAt] of taskCreatedAt) {
    if (createdAt < cutoff) {
      tasks.delete(id);
      runLinks.delete(id);
      taskCreatedAt.delete(id);
    }
  }
}
