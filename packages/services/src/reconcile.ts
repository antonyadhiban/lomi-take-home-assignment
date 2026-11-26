import { enqueueExtraction } from "@lomi/queue";
import type { Deps } from "./deps.js";

/** queued runs younger than this are assumed to be in flight from the API */
const QUEUED_GRACE_MS = 5_000;

/**
 * Postgres is the source of truth for "what work exists"; Redis only holds a
 * copy of it. This makes Redis match Postgres again after a restart, a killed
 * worker or a FLUSHALL:
 *  - `queued` runs (older than a short grace period) and
 *  - `running` runs whose lease expired (their worker died)
 * are re-enqueued unless BullMQ already has a live job for them.
 *
 * jobId === runId, so this is idempotent. BullMQ silently ignores add() when a
 * finished job with that id is still retained, so finished jobs are removed
 * first. processRun's claim protects against double processing anyway.
 */
export async function reconcile(deps: Deps): Promise<{ enqueued: string[] }> {
  const now = Date.now();
  const runs = await deps.prisma.extractionRun.findMany({
    where: {
      OR: [
        { status: "queued", createdAt: { lt: new Date(now - QUEUED_GRACE_MS) } },
        { status: "running", leaseUntil: { lt: new Date(now) } },
      ],
    },
    select: { id: true },
    take: 500,
  });

  const enqueued: string[] = [];
  for (const { id } of runs) {
    const job = await deps.queue.getJob(id);
    if (job) {
      const state = await job.getState();
      if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized" || state === "waiting-children") {
        continue;
      }
      await job.remove();
    }
    await enqueueExtraction(deps.queue, id);
    enqueued.push(id);
  }
  if (enqueued.length) deps.log?.info(`reconciler re-enqueued ${enqueued.length} run(s): ${enqueued.join(", ")}`);
  return { enqueued };
}
