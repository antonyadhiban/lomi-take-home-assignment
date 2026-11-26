import { createPrisma } from "@lomi/db";
import { createOpenRouterProvider } from "@lomi/extraction";
import { createExtractionQueue, createRedis, EXTRACTION_QUEUE, type ExtractionJob } from "@lomi/queue";
import { processRun, reconcile, type Deps } from "@lomi/services";
import { createStorage } from "@lomi/storage";
import { Worker } from "bullmq";

const RECONCILE_EVERY_MS = Number(process.env.RECONCILE_EVERY_MS ?? 30_000);

const prisma = createPrisma();
const queueConn = createRedis();
const workerConn = createRedis();
const deps: Deps = {
  prisma,
  storage: createStorage(),
  queue: createExtractionQueue(queueConn),
  provider: createOpenRouterProvider(),
  log: console,
};

/**
 * The job handler never throws for extraction failures: processRun records
 * them as `failed` state in Postgres. A throw here means infrastructure
 * trouble (DB down); BullMQ's retry + the reconciler cover that.
 */
const worker = new Worker<ExtractionJob>(
  EXTRACTION_QUEUE,
  async (job) => {
    const outcome = await processRun(deps, job.data.runId);
    console.info(`run ${job.data.runId}: ${outcome}`);
    return outcome;
  },
  { connection: workerConn, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) },
);
worker.on("failed", (job, err) => console.error(`job ${job?.id} errored: ${err.message}`));

// Reconcile on boot (covers restarts and FLUSHALL) and periodically after.
let reconciling = false;
const tick = async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    await reconcile(deps);
  } catch (err) {
    console.error(`reconcile failed: ${(err as Error).message}`);
  } finally {
    reconciling = false;
  }
};
await tick();
const timer = setInterval(tick, RECONCILE_EVERY_MS);
console.info(`worker started (model: ${deps.provider?.model})`);

const shutdown = async () => {
  clearInterval(timer);
  await worker.close();
  await deps.queue.close();
  queueConn.disconnect();
  workerConn.disconnect();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
