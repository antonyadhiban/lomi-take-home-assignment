import { Worker } from "bullmq";
import { createRedis, EXTRACTION_QUEUE, type ExtractionJob } from "@lomi/queue";

/**
 * Two loops:
 *  - BullMQ worker: claims a run (Postgres lease), parses, calls the LLM,
 *    validates evidence, commits values + carry-over in one transaction.
 *  - Reconciler: on boot and every 30s, re-enqueues runs Postgres says are
 *    queued/expired-lease but Redis has no job for (restart, FLUSHALL).
 * Both land next; this is the process skeleton.
 */
const connection = createRedis();
const worker = new Worker<ExtractionJob>(
  EXTRACTION_QUEUE,
  async (job) => {
    job.log(`TODO: process run ${job.data.runId}`);
  },
  { connection, concurrency: 4 },
);

const shutdown = async () => {
  await worker.close();
  await connection.quit();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log("worker started");
