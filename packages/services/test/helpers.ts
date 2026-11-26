import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmField } from "@lomi/core";
import { createPrisma } from "@lomi/db";
import type { ExtractionProvider } from "@lomi/extraction";
import { createRedis, EXTRACTION_QUEUE, type ExtractionJob } from "@lomi/queue";
import type { Storage } from "@lomi/storage";
import { Queue } from "bullmq";
import type { Deps } from "../src/index.js";

export const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/documents");
export const fixture = async (name: string) => new Uint8Array(await readFile(path.join(FIXTURES, name)));

export function memoryStorage(): Storage {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) throw new Error(`no object ${key}`);
      return o;
    },
    async ensureBucket() {},
  };
}

const line = (text: string, re: RegExp): LlmField | null => {
  const m = re.exec(text);
  return m ? { field: "", value: m[1]!, evidence: m[0], gap_reason: null } : null;
};

/**
 * Deterministic stand-in for the LLM: reads the invoice fields out of the
 * real parsed PDF text with regexes and quotes the matching line as evidence.
 */
export function fakeInvoiceProvider(overrides: (fields: LlmField[]) => LlmField[] = (f) => f): ExtractionProvider & { calls: number } {
  const p = {
    model: "fake/invoice",
    calls: 0,
    async extract({ text }: { text: string }) {
      p.calls++;
      const pick = (field: string, re: RegExp): LlmField =>
        ({ ...(line(text, re) ?? { value: null, evidence: null, gap_reason: "not found" }), field }) as LlmField;
      const fields = overrides([
        pick("invoice_number", /Invoice Number: (\S+)/),
        pick("issue_date", /Issue Date: (\S+)/),
        pick("due_date", /Due Date: (\S+)/),
        pick("vendor_name", /^(MERIDIAN OFFICE SUPPLIES LLC)/m),
        pick("total_amount", /Total Due: (\$[\d,.]+)/),
      ]);
      return {
        model: "fake/invoice",
        prompt: "fake prompt",
        rawResponse: { fields },
        fields,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
      };
    },
  };
  return p;
}

export async function makeDeps(provider?: ExtractionProvider): Promise<Deps & { close(): Promise<void>; prefix: string }> {
  const prisma = createPrisma(process.env.TEST_DATABASE_URL);
  const redis = createRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
  // unique BullMQ prefix per test so suites never see each other's jobs
  const prefix = `test-${crypto.randomUUID()}`;
  const queue = new Queue<ExtractionJob>(EXTRACTION_QUEUE, { connection: redis, prefix });
  return {
    prisma,
    storage: memoryStorage(),
    queue,
    provider,
    prefix,
    async close() {
      await queue.obliterate({ force: true });
      await queue.close();
      redis.disconnect();
      await prisma.$disconnect();
    },
  };
}

export async function resetDb(deps: Deps) {
  await deps.prisma.$executeRawUnsafe(
    `TRUNCATE "ReviewEvent", "ExtractedValue", "ExtractionRun", "DocumentVersion", "Document" CASCADE`,
  );
}

export async function activeRunId(deps: Deps, documentId: string) {
  const doc = await deps.prisma.document.findUniqueOrThrow({ where: { id: documentId }, include: { currentVersion: true } });
  const run = await deps.prisma.extractionRun.findFirstOrThrow({
    where: { versionId: doc.currentVersionId! },
    orderBy: { attempt: "desc" },
  });
  return run.id;
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
