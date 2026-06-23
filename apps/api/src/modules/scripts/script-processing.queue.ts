import { Queue, Worker, type Job } from "bullmq";
import { getBullMqConnectionOptions } from "../../queue/redis";

export const SCRIPT_PROCESSING_QUEUE = "script-processing";

export type ScriptProcessingQueueJob = {
  jobId: string;
};

let queue: Queue<any> | null = null;
let worker: Worker<any> | null = null;

export function getScriptProcessingQueue() {
  const connection = getBullMqConnectionOptions();
  if (!connection) return null;
  if (!queue) {
    queue = new Queue(SCRIPT_PROCESSING_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 1500 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 }
      }
    });
  }
  return queue;
}

export async function enqueueScriptProcessingJob(jobId: string) {
  const scriptQueue = getScriptProcessingQueue();
  if (!scriptQueue) return null;
  return scriptQueue.add("process-script", { jobId }, { jobId, priority: 5 });
}

export function startScriptProcessingWorker(handler: (jobId: string) => Promise<void>, options: { getAI?: () => unknown }) {
  const connection = getBullMqConnectionOptions();
  if (!connection || worker) return null;

  worker = new Worker(
    SCRIPT_PROCESSING_QUEUE,
    async (job: Job<ScriptProcessingQueueJob>) => handler(job.data.jobId),
    {
      connection,
      concurrency: Number(process.env.SCRIPT_WORKER_CONCURRENCY || 1),
      limiter: { max: Number(process.env.SCRIPT_WORKER_RATE_LIMIT || 10), duration: 60_000 }
    }
  );

  worker.on("failed", (job, error) => {
    console.error(`[ScriptQueue] Job ${job?.id || "unknown"} failed:`, error);
  });
  worker.on("stalled", (jobId) => {
    console.warn(`[ScriptQueue] Job ${jobId} stalled.`);
  });

  process.once("SIGTERM", () => void worker?.close());
  process.once("SIGINT", () => void worker?.close());

  console.log(`[ScriptQueue] Worker started for ${SCRIPT_PROCESSING_QUEUE}.`, { hasGetAI: !!options.getAI });
  return worker;
}
