import type { PrismaClient } from "@lomi/db";
import type { ExtractionProvider } from "@lomi/extraction";
import type { ExtractionJob } from "@lomi/queue";
import type { Storage } from "@lomi/storage";
import type { Queue } from "bullmq";

/** Everything the services touch, injected so tests can swap the LLM and storage. */
export interface Deps {
  prisma: PrismaClient;
  storage: Storage;
  queue: Queue<ExtractionJob>;
  provider?: ExtractionProvider;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
