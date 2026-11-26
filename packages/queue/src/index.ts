import { Queue } from "bullmq";
import { Redis } from "ioredis";

/**
 * Redis coordinates work and nothing else. A job carries only the Postgres run
 * id; jobId === runId so re-enqueuing (reconciler, retries, impatient users)
 * is idempotent at the queue level too.
 */
export const EXTRACTION_QUEUE = "extraction";

export interface ExtractionJob {
  runId: string;
}

export function createRedis(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error("REDIS_URL is not set");
  // BullMQ requires maxRetriesPerRequest: null for blocking connections
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createExtractionQueue(connection: Redis): Queue<ExtractionJob> {
  return new Queue<ExtractionJob>(EXTRACTION_QUEUE, {
    connection,
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000 },
  });
}

export async function enqueueExtraction(queue: Queue<ExtractionJob>, runId: string): Promise<void> {
  await queue.add("extract", { runId }, { jobId: runId });
}
