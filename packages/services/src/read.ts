import { FIELDS, isDocumentType, replay, type FieldType } from "@lomi/core";
import type { ExtractedValue, ReviewEvent } from "@lomi/db";
import { ServiceError, type Deps } from "./deps.js";

export type ValueStatus = "pending" | "approved" | "corrected" | "carried_over";

export interface Progress {
  total: number;
  pending: number;
  approved: number;
  corrected: number;
  carried_over: number;
  gaps: number;
}

type ValueWithReviews = ExtractedValue & { reviews: ReviewEvent[] };

/** Progress bucket of a value = the action currently in effect (undo/redo replayed). */
export function valueStatus(reviews: ReviewEvent[]): ValueStatus {
  const top = replay(reviews).done.at(-1);
  if (!top) return "pending";
  if (top.kind === "carried_over") return "carried_over";
  return top.state === "pending" ? "pending" : top.state;
}

function effective(v: ExtractedValue, latest: ReviewEvent | undefined): string | null {
  return latest?.state === "corrected" ? latest.resultValue : v.value;
}

export function progressOf(values: ValueWithReviews[]): Progress {
  const p: Progress = { total: values.length, pending: 0, approved: 0, corrected: 0, carried_over: 0, gaps: 0 };
  for (const v of values) {
    p[valueStatus(v.reviews)]++;
    if (v.value == null) p.gaps++;
  }
  return p;
}

const reviewsAsc = { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] };

function eventView(e: ReviewEvent) {
  return {
    id: e.id,
    kind: e.kind,
    state: e.state,
    resultValue: e.resultValue,
    note: e.note,
    reviewer: e.reviewer,
    sourceEventId: e.sourceEventId,
    createdAt: e.createdAt,
  };
}

function valueView(
  v: ValueWithReviews & { previousValue: (ValueWithReviews & { version: { version: number } }) | null },
  type: FieldType,
) {
  const latest = v.reviews.at(-1);
  const status = valueStatus(v.reviews);
  const prev = v.previousValue;
  const prevLatest = prev?.reviews.at(-1);
  return {
    id: v.id,
    field: v.field,
    type,
    value: v.value,
    evidence: v.evidence,
    gapReason: v.gapReason,
    isGap: v.value == null,
    status,
    effectiveValue: effective(v, latest),
    note: latest?.state === "pending" ? null : (latest?.note ?? null),
    latestEventId: latest?.id ?? null,
    canUndo: replay(v.reviews).done.length > 0,
    canRedo: replay(v.reviews).redo.length > 0,
    history: v.reviews.map(eventView),
    previous: prev
      ? {
          versionNumber: prev.version.version,
          value: prev.value,
          evidence: prev.evidence,
          gapReason: prev.gapReason,
          status: valueStatus(prev.reviews),
          effectiveValue: effective(prev, prevLatest),
          note: prevLatest?.note ?? null,
        }
      : null,
    /** a prior version existed and this value did NOT inherit its review */
    needsReReview: prev != null && status !== "carried_over" && valueStatus(prev.reviews) !== "pending",
  };
}

export async function listDocuments(deps: Deps) {
  const docs = await deps.prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      currentVersion: { include: { values: { include: { reviews: reviewsAsc } } } },
      versions: { where: { status: "extracted" }, orderBy: { version: "desc" }, take: 1, select: { version: true } },
    },
  });
  return docs.map((d) => ({
    id: d.id,
    type: d.type,
    title: d.title,
    createdAt: d.createdAt,
    currentVersion: d.currentVersion?.version ?? null,
    status: d.currentVersion?.status ?? null,
    error: d.currentVersion?.error ?? null,
    latestExtractedVersion: d.versions[0]?.version ?? null,
    progress: progressOf(d.currentVersion?.values ?? []),
  }));
}

/**
 * Document with one version's values. Defaults to the current version; older
 * versions stay fully queryable (?version=N) with their own text and reviews.
 */
export async function getDocument(deps: Deps, id: string, versionNumber?: number) {
  const doc = await deps.prisma.document.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      versions: { orderBy: { version: "asc" }, select: { version: true, status: true, error: true, createdAt: true } },
    },
  });
  if (!doc || !doc.currentVersion) throw new ServiceError(404, "document not found");
  if (!isDocumentType(doc.type)) throw new Error(`bad type ${doc.type}`);

  const wanted = versionNumber ?? doc.currentVersion.version;
  const version = await deps.prisma.documentVersion.findUnique({
    where: { documentId_version: { documentId: id, version: wanted } },
    include: {
      values: {
        include: {
          reviews: reviewsAsc,
          previousValue: { include: { reviews: reviewsAsc, version: { select: { version: true } } } },
        },
      },
      runs: { orderBy: { attempt: "desc" }, take: 1, select: { id: true, attempt: true, status: true, model: true, error: true, finishedAt: true } },
    },
  });
  if (!version) throw new ServiceError(404, `version ${wanted} not found`);

  const order = FIELDS[doc.type].map((f) => f.field);
  const types = new Map(FIELDS[doc.type].map((f) => [f.field, f.type]));
  const values = [...version.values]
    .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field))
    .map((v) => valueView(v, types.get(v.field) ?? "string"));

  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    currentVersion: doc.currentVersion.version,
    /** status of the current version (what the brief's `status` means) */
    status: doc.currentVersion.status,
    versions: doc.versions,
    version: {
      version: version.version,
      status: version.status,
      error: version.error,
      isCurrent: version.id === doc.currentVersion.id,
      parsedText: version.parsedText,
      lastRun: version.runs[0] ?? null,
    },
    values,
    progress: progressOf(version.values),
  };
}

export async function getProgress(deps: Deps, id: string) {
  const doc = await deps.prisma.document.findUnique({
    where: { id },
    include: { currentVersion: { include: { values: { include: { reviews: reviewsAsc } } } } },
  });
  if (!doc?.currentVersion) throw new ServiceError(404, "document not found");
  return {
    documentId: id,
    version: doc.currentVersion.version,
    status: doc.currentVersion.status,
    ...progressOf(doc.currentVersion.values),
  };
}

/** The original PDF of one version, for the in-browser viewer. */
export async function getVersionFile(deps: Deps, id: string, versionNumber: number) {
  const version = await deps.prisma.documentVersion.findUnique({
    where: { documentId_version: { documentId: id, version: versionNumber } },
    select: { storageKey: true, sha256: true },
  });
  if (!version) throw new ServiceError(404, "version not found");
  return { bytes: await deps.storage.get(version.storageKey), etag: version.sha256 };
}
