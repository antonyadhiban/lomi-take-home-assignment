import { randomUUID } from "node:crypto";
import { decideCarryOver, FIELDS, isDocumentType, validateExtraction } from "@lomi/core";
import { Prisma } from "@lomi/db";
import { ExtractionError, parsePdfText } from "@lomi/extraction";
import type { Deps } from "./deps.js";

export const LEASE_MS = 60_000;
const HEARTBEAT_MS = 20_000;
/** a run whose worker died this many times is failed instead of reclaimed forever */
export const MAX_CLAIMS = 3;

export type ProcessOutcome = "succeeded" | "failed" | "skipped" | "cancelled";

/**
 * Process one extraction run. Safe to call any number of times for the same
 * run, concurrently or after a crash:
 *  - claim: an atomic UPDATE only succeeds if the run is `queued`, or `running`
 *    with an expired lease (its worker died). Anyone else gets "skipped".
 *  - commit: one transaction that re-checks the claim token, so a worker whose
 *    lease expired mid-call can't land stale results over a newer claim.
 *  - UNIQUE(versionId, field) is the last line of defense against duplicates.
 * Failures (PDF parse, LLM, malformed output) become `failed` state on the run
 * and the version, never a thrown exception.
 */
export async function processRun(deps: Deps, runId: string): Promise<ProcessOutcome> {
  const { prisma } = deps;
  const token = randomUUID();
  const now = new Date();

  const claimed = await prisma.extractionRun.updateMany({
    where: {
      id: runId,
      OR: [{ status: "queued" }, { status: "running", leaseUntil: { lt: now } }],
      version: { status: { in: ["queued", "extracting"] } },
    },
    data: {
      status: "running",
      claimToken: token,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      startedAt: now,
      claims: { increment: 1 },
    },
  });
  if (claimed.count === 0) return "skipped";

  const run = await prisma.extractionRun.findUniqueOrThrow({
    where: { id: runId },
    include: { version: { include: { document: true } } },
  });

  if (run.claims > MAX_CLAIMS) {
    await failRun(deps, runId, token, `worker crashed ${run.claims - 1} times while extracting; retry to try again`);
    return "failed";
  }

  await prisma.documentVersion.updateMany({
    where: { id: run.versionId, status: { in: ["queued", "extracting"] } },
    data: { status: "extracting" },
  });

  const heartbeat = setInterval(() => {
    prisma.extractionRun
      .updateMany({
        where: { id: runId, claimToken: token, status: "running" },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch((err: unknown) => deps.log?.warn(`heartbeat failed for ${runId}: ${String(err)}`));
  }, HEARTBEAT_MS);

  let prompt: string | undefined;
  let rawResponse: unknown;
  try {
    const { version } = run;
    const docType = version.document.type;
    if (!isDocumentType(docType)) throw new Error(`unknown document type ${docType}`);
    if (!deps.provider) throw new Error("no extraction provider configured");

    // Parse once per version and store it: evidence checks and the review UI
    // for version N always use version N's text, even after N+1 exists.
    let text = version.parsedText;
    if (text == null) {
      text = await parsePdfText(await deps.storage.get(version.storageKey));
      if (text.trim() === "") throw new Error("PDF contains no extractable text (scanned image?)");
      await prisma.documentVersion.update({ where: { id: version.id }, data: { parsedText: text } });
    }

    const defs = FIELDS[docType];
    const result = await deps.provider.extract({ documentType: docType, fields: defs, text });
    prompt = result.prompt;
    rawResponse = result.rawResponse;
    const validated = validateExtraction(defs, result.fields, text);

    return await commit(deps, {
      runId,
      token,
      versionId: version.id,
      documentId: version.documentId,
      versionNumber: version.version,
      text,
      validated,
      model: result.model,
      prompt: result.prompt,
      rawResponse: { response: result.rawResponse, usage: result.usage },
    });
  } catch (err) {
    if (err instanceof ExtractionError) {
      prompt = err.details.prompt;
      rawResponse = err.details.rawResponse;
    }
    const message = err instanceof Error ? err.message : String(err);
    deps.log?.error(`run ${runId} failed: ${message}`);
    await failRun(deps, runId, token, message, { prompt, rawResponse });
    return "failed";
  } finally {
    clearInterval(heartbeat);
  }
}

async function failRun(
  deps: Deps,
  runId: string,
  token: string,
  error: string,
  debug: { prompt?: string; rawResponse?: unknown } = {},
) {
  await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.extractionRun.updateMany({
      where: { id: runId, claimToken: token, status: "running" },
      data: {
        status: "failed",
        error,
        finishedAt: new Date(),
        leaseUntil: null,
        prompt: debug.prompt,
        rawResponse: debug.rawResponse === undefined ? undefined : (debug.rawResponse as Prisma.InputJsonValue),
      },
    });
    if (updated.count === 0) return; // superseded/reclaimed meanwhile: not ours to fail
    const run = await tx.extractionRun.findUniqueOrThrow({ where: { id: runId } });
    await tx.documentVersion.updateMany({
      where: { id: run.versionId, status: { in: ["queued", "extracting"] } },
      data: { status: "failed", error },
    });
  });
}

interface CommitInput {
  runId: string;
  token: string;
  versionId: string;
  documentId: string;
  versionNumber: number;
  text: string;
  validated: ReturnType<typeof validateExtraction>;
  model: string;
  prompt: string;
  rawResponse: unknown;
}

async function commit(deps: Deps, c: CommitInput): Promise<ProcessOutcome> {
  try {
    return await deps.prisma.$transaction(async (tx) => {
      // Lock the run row and re-check that we still own it.
      const [owned] = await tx.$queryRaw<{ status: string; claimToken: string | null }[]>`
        SELECT status, "claimToken" FROM "ExtractionRun" WHERE id = ${c.runId} FOR UPDATE`;
      if (!owned || owned.status !== "running" || owned.claimToken !== c.token) {
        return owned?.status === "cancelled" ? "cancelled" : "skipped";
      }
      const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: c.versionId } });
      if (version.status === "superseded") {
        await tx.extractionRun.update({
          where: { id: c.runId },
          data: { status: "cancelled", finishedAt: new Date(), error: "superseded by a newer version" },
        });
        return "cancelled";
      }

      // Carry-over source: the latest *extracted* version before this one
      // (superseded/failed versions in between have no reviews to carry).
      const prior = await tx.documentVersion.findFirst({
        where: { documentId: c.documentId, version: { lt: c.versionNumber }, status: "extracted" },
        orderBy: { version: "desc" },
        include: {
          values: { include: { reviews: { orderBy: { createdAt: "desc" }, take: 1 } } },
        },
      });
      const priorByField = new Map(prior?.values.map((v) => [v.field, v]) ?? []);

      for (const v of c.validated) {
        const p = priorByField.get(v.field);
        const created = await tx.extractedValue.create({
          data:
            v.kind === "value"
              ? {
                  versionId: c.versionId,
                  runId: c.runId,
                  field: v.field,
                  value: v.value,
                  normalizedValue: v.normalizedValue,
                  evidence: v.evidence,
                  evidenceStart: v.evidenceStart,
                  evidenceEnd: v.evidenceEnd,
                  previousValueId: p?.id,
                }
              : {
                  versionId: c.versionId,
                  runId: c.runId,
                  field: v.field,
                  gapReason: v.gapReason,
                  previousValueId: p?.id,
                },
        });

        const decision = decideCarryOver(
          p ? { field: p.field, normalizedValue: p.normalizedValue, evidence: p.evidence } : undefined,
          { field: v.field, normalizedValue: v.kind === "value" ? v.normalizedValue : null, evidence: v.kind === "value" ? v.evidence : null },
          c.text,
        );
        const priorReview = p?.reviews[0];
        if (decision.carry && priorReview && priorReview.state !== "pending") {
          await tx.reviewEvent.create({
            data: {
              valueId: created.id,
              kind: "carried_over",
              state: priorReview.state,
              resultValue: priorReview.resultValue,
              note: priorReview.note,
              reviewer: "system",
              sourceEventId: priorReview.id,
            },
          });
        }
      }

      await tx.extractionRun.update({
        where: { id: c.runId },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          leaseUntil: null,
          model: c.model,
          prompt: c.prompt,
          rawResponse: c.rawResponse as Prisma.InputJsonValue,
        },
      });
      await tx.documentVersion.update({ where: { id: c.versionId }, data: { status: "extracted", error: null } });
      return "succeeded" as const;
    });
  } catch (err) {
    // Values for this version already exist: an earlier run committed. Not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "skipped";
    throw err;
  }
}
