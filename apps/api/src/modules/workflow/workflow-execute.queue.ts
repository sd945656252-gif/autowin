import { Queue, Worker, type Job } from "bullmq";
import type express from "express";
import type { GoogleGenAI } from "@google/genai";
import { getBullMqConnectionOptions } from "../../queue/redis";

export const WORKFLOW_EXECUTION_QUEUE = "workflow-executions";

export type WorkflowExecutionJobData = {
  taskId: string;
  runId: string;
  body: any;
  requestContext: {
    host?: string;
    protocol?: string;
    forwardedProto?: string;
    userId?: string;
    userRole?: string;
  };
};

let queue: Queue<any> | null = null;
let worker: Worker<any> | null = null;

export function getWorkflowExecutionQueue() {
  const connection = getBullMqConnectionOptions();
  if (!connection) return null;
  if (!queue) {
    queue = new Queue(WORKFLOW_EXECUTION_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 }
      }
    });
  }
  return queue;
}

export function createRequestContext(req: express.Request, userId?: string, userRole?: string): WorkflowExecutionJobData["requestContext"] {
  const forwardedProto = req.headers["x-forwarded-proto"];
  return {
    host: req.get("host") || "localhost:3000",
    protocol: req.protocol || "http",
    forwardedProto: Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto,
    userId,
    userRole
  };
}

export async function enqueueWorkflowExecution(data: WorkflowExecutionJobData) {
  const workflowQueue = getWorkflowExecutionQueue();
  if (!workflowQueue) return null;
  return workflowQueue.add("execute-node", data, {
    jobId: data.runId,
    priority: 5
  });
}

export function startWorkflowExecutionWorker(handler: (job: Job<WorkflowExecutionJobData>) => Promise<void>, options: { getAI: () => GoogleGenAI }) {
  const connection = getBullMqConnectionOptions();
  if (!connection || worker) return null;

  worker = new Worker(WORKFLOW_EXECUTION_QUEUE, handler as any, {
    connection,
    concurrency: Number(process.env.WORKFLOW_WORKER_CONCURRENCY || 2),
    limiter: {
      max: Number(process.env.WORKFLOW_WORKER_RATE_LIMIT || 20),
      duration: 60_000
    }
  });

  worker.on("failed", (job, error) => {
    console.error(`[WorkflowQueue] Job ${job?.id || "unknown"} failed:`, error);
  });
  worker.on("stalled", (jobId) => {
    console.warn(`[WorkflowQueue] Job ${jobId} stalled.`);
  });

  process.once("SIGTERM", () => void worker?.close());
  process.once("SIGINT", () => void worker?.close());

  console.log(`[WorkflowQueue] Worker started for ${WORKFLOW_EXECUTION_QUEUE}.`, { hasGetAI: !!options.getAI });
  return worker;
}
