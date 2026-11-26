import { createPrisma } from "@lomi/db";
import { createExtractionQueue, createRedis } from "@lomi/queue";
import type { Deps } from "@lomi/services";
import { createStorage } from "@lomi/storage";

export function createDeps(): Deps & { close(): Promise<void> } {
  const prisma = createPrisma();
  const redis = createRedis();
  const queue = createExtractionQueue(redis);
  return {
    prisma,
    storage: createStorage(),
    queue,
    log: console,
    async close() {
      await queue.close();
      redis.disconnect();
      await prisma.$disconnect();
    },
  };
}

/** Object storage can take a moment to come up in compose. */
export async function waitForStorage(deps: Deps, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      await deps.storage.ensureBucket();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
