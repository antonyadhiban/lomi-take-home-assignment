import { createHash } from "node:crypto";
import { isDocumentType } from "@lomi/core";
import { enqueueExtraction } from "@lomi/queue";
import { ServiceError, type Deps } from "./deps.js";

const isPdf = (b: Uint8Array) => b.length > 4 && Buffer.from(b.subarray(0, 5)).toString("latin1") === "%PDF-";

/** Content-addressed key: uploading happens before the DB transaction, so the
 *  key can't depend on the version number; an orphaned object is harmless. */
const objectKey = (documentId: string, sha256: string) => `documents/${documentId}/${sha256}.pdf`;

/**
 * Enqueue is best-effort by design. Postgres already says the run is queued;
 * if Redis is down or flushed, the reconciler will enqueue it.
 */
async function tryEnqueue(deps: Deps, runId: string) {
  try {
    await enqueueExtraction(deps.queue, runId);
  } catch (err) {
    deps.log?.warn(`enqueue failed for run ${runId}; reconciler will pick it up: ${(err as Error).message}`);
  }
}

export async function createDocument(
  deps: Deps,
  input: { type: string; title?: string; file: Uint8Array; id?: string },
) {
  if (!isDocumentType(input.type)) throw new ServiceError(400, `unknown document type "${input.type}"`);
  if (!isPdf(input.file)) throw new ServiceError(400, "file is not a PDF");

  const sha256 = createHash("sha256").update(input.file).digest("hex");
  const id = input.id ?? crypto.randomUUID();
  const storageKey = objectKey(id, sha256);
  await deps.storage.put(storageKey, input.file, "application/pdf");

  const { document, runId } = await deps.prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: { id, type: input.type, title: input.title?.trim() || `Untitled ${input.type}` },
    });
    const version = await tx.documentVersion.create({
      data: { documentId: id, version: 1, storageKey, sha256 },
    });
    const run = await tx.extractionRun.create({ data: { versionId: version.id, attempt: 1 } });
    await tx.document.update({ where: { id }, data: { currentVersionId: version.id } });
    return { document, runId: run.id };
  });

  await tryEnqueue(deps, runId);
  return document;
}

/**
 * New version of an existing document. Policy when the previous version is
 * still queued/extracting: SUPERSEDE. The old version is marked superseded and
 * its active run cancelled in the same transaction; if its worker is mid-LLM
 * call, its commit is rejected later because the run is no longer `running`.
 *
 * Uploads for the same document are serialized with a row lock, so two
 * concurrent uploads get versions N+1 and N+2, never a collision.
 * Re-uploading the exact bytes of the latest version is a no-op.
 */
export async function addVersion(deps: Deps, documentId: string, file: Uint8Array) {
  if (!isPdf(file)) throw new ServiceError(400, "file is not a PDF");
  const doc = await deps.prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new ServiceError(404, "document not found");

  const sha256 = createHash("sha256").update(file).digest("hex");
  const storageKey = objectKey(documentId, sha256);
  await deps.storage.put(storageKey, file, "application/pdf");

  const result = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`;
    const latest = await tx.documentVersion.findFirst({
      where: { documentId },
      orderBy: { version: "desc" },
    });
    if (latest && latest.sha256 === sha256) {
      return { version: latest, runId: null, duplicate: true };
    }

    // supersede anything still in flight
    const inflight = await tx.documentVersion.findMany({
      where: { documentId, status: { in: ["queued", "extracting"] } },
      select: { id: true },
    });
    if (inflight.length) {
      const ids = inflight.map((v) => v.id);
      await tx.documentVersion.updateMany({ where: { id: { in: ids } }, data: { status: "superseded" } });
      await tx.extractionRun.updateMany({
        where: { versionId: { in: ids }, status: { in: ["queued", "running"] } },
        data: { status: "cancelled", finishedAt: new Date(), error: "superseded by a newer version" },
      });
    }

    const version = await tx.documentVersion.create({
      data: { documentId, version: (latest?.version ?? 0) + 1, storageKey, sha256 },
    });
    const run = await tx.extractionRun.create({ data: { versionId: version.id, attempt: 1 } });
    await tx.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } });
    return { version, runId: run.id, duplicate: false };
  });

  if (result.runId) await tryEnqueue(deps, result.runId);
  return { version: result.version, duplicate: result.duplicate };
}

/**
 * Retry a failed current version. A retry while one is already queued or
 * running is rejected (and the partial unique index would stop a duplicate
 * active run even if two retries raced past this check).
 */
export async function retryExtraction(deps: Deps, documentId: string) {
  const runId = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`;
    const doc = await tx.document.findUnique({ where: { id: documentId }, include: { currentVersion: true } });
    if (!doc?.currentVersion) throw new ServiceError(404, "document not found");
    const v = doc.currentVersion;
    if (v.status !== "failed") throw new ServiceError(409, `current version is ${v.status}; only failed versions can be retried`);
    const last = await tx.extractionRun.findFirst({ where: { versionId: v.id }, orderBy: { attempt: "desc" } });
    const run = await tx.extractionRun.create({ data: { versionId: v.id, attempt: (last?.attempt ?? 0) + 1 } });
    await tx.documentVersion.update({ where: { id: v.id }, data: { status: "queued", error: null } });
    return run.id;
  });
  await tryEnqueue(deps, runId);
}
