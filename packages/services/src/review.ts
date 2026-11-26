import { FIELDS, isDocumentType, normalizeValue, planRedo, planUndo } from "@lomi/core";
import { ServiceError, type Deps } from "./deps.js";

export type ReviewAction =
  | { action: "approve"; note?: string }
  | { action: "correct"; value: string; note?: string }
  /** undo/redo/restore: re-apply the state of an earlier event on this value */
  | { action: "restore"; eventId: string }
  /** undo back to "never reviewed" */
  | { action: "reset" }
  /** undo/redo the latest action; the stacks are replayed from the stored history */
  | { action: "undo" }
  | { action: "redo" };

/**
 * Reviews are append-only events; the LLM's extracted value is never modified.
 * Only the current, extracted version can be reviewed: older versions are a
 * read-only record. `expectedLatestEventId` (optional) gives optimistic
 * concurrency: if someone else reviewed in the meantime you get a 409.
 */
export async function applyReview(
  deps: Deps,
  valueId: string,
  input: ReviewAction & { reviewer?: string; expectedLatestEventId?: string | null },
) {
  return deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ExtractedValue" WHERE id = ${valueId} FOR UPDATE`;
    const value = await tx.extractedValue.findUnique({
      where: { id: valueId },
      include: {
        version: { include: { document: true, currentOf: true } },
        reviews: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!value) throw new ServiceError(404, "value not found");
    if (!value.version.currentOf || value.version.status !== "extracted") {
      throw new ServiceError(409, "only values of the current, extracted version can be reviewed");
    }
    const latest = value.reviews.at(-1);
    if (input.expectedLatestEventId !== undefined && (latest?.id ?? null) !== input.expectedLatestEventId) {
      throw new ServiceError(409, "this value was reviewed by someone else in the meantime; reload and try again");
    }
    const reviewer = input.reviewer?.trim() || "reviewer";
    const note = "note" in input ? input.note?.trim() || null : null;

    switch (input.action) {
      case "approve":
        return tx.reviewEvent.create({
          data: { valueId, kind: "approved", state: "approved", resultValue: value.value, note, reviewer },
        });
      case "correct": {
        const type = isDocumentType(value.version.document.type)
          ? FIELDS[value.version.document.type].find((f) => f.field === value.field)?.type
          : undefined;
        const corrected = input.value?.trim();
        if (!corrected) throw new ServiceError(400, "a correction needs a value");
        if (type && normalizeValue(type, corrected) == null) {
          throw new ServiceError(400, `"${corrected}" is not a valid ${type}`);
        }
        return tx.reviewEvent.create({
          data: { valueId, kind: "corrected", state: "corrected", resultValue: corrected, note, reviewer },
        });
      }
      case "restore": {
        const source = await tx.reviewEvent.findFirst({ where: { id: input.eventId, valueId } });
        if (!source) throw new ServiceError(404, "event not found on this value");
        return tx.reviewEvent.create({
          data: {
            valueId,
            kind: "restored",
            state: source.state,
            resultValue: source.resultValue,
            note: source.note,
            reviewer,
            sourceEventId: source.id,
          },
        });
      }
      case "reset":
        return tx.reviewEvent.create({
          data: { valueId, kind: "restored", state: "pending", resultValue: null, reviewer },
        });
      case "undo":
      case "redo": {
        const plan = input.action === "undo" ? planUndo(value.reviews) : planRedo(value.reviews);
        if (!plan) throw new ServiceError(409, `nothing to ${input.action}`);
        return tx.reviewEvent.create({ data: { valueId, reviewer, ...plan } });
      }
      default:
        throw new ServiceError(400, "unknown review action");
    }
  });
}
