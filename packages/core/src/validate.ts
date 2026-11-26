import { checkEvidence } from "./evidence.js";
import type { FieldDef } from "./fields.js";
import { normalizeValue } from "./normalize.js";

/** What the LLM returned for one field (untrusted). */
export interface LlmField {
  field: string;
  value: string | null;
  evidence: string | null;
  gap_reason: string | null;
}

/** What we are willing to store. Exactly one entry per expected field. */
export type ValidatedValue =
  | {
      field: string;
      kind: "value";
      value: string;
      normalizedValue: string;
      evidence: string;
      evidenceStart: number;
      evidenceEnd: number;
    }
  | {
      field: string;
      kind: "gap";
      gapReason: string;
      /** what the LLM claimed, kept for debugging/the review UI; never trusted */
      rejectedValue: string | null;
      rejectedEvidence: string | null;
    };

/**
 * Turns raw LLM output into storable values. Anything that fails a check
 * becomes a gap with a reason — never a guess:
 *  - field missing from the response, or the LLM said it isn't there
 *  - evidence not found verbatim in THIS version's parsed text
 *  - value not interpretable as the field's type
 * Unknown/duplicate fields in the response are ignored (first one wins).
 */
export function validateExtraction(
  defs: readonly FieldDef[],
  llmFields: readonly LlmField[],
  parsedText: string,
): ValidatedValue[] {
  const byField = new Map<string, LlmField>();
  for (const f of llmFields) if (!byField.has(f.field)) byField.set(f.field, f);

  return defs.map((def): ValidatedValue => {
    const got = byField.get(def.field);
    const gap = (gapReason: string): ValidatedValue => ({
      field: def.field,
      kind: "gap",
      gapReason,
      rejectedValue: got?.value ?? null,
      rejectedEvidence: got?.evidence ?? null,
    });

    if (!got) return gap("field missing from model response");
    if (got.value == null || got.value.trim() === "") {
      return gap(got.gap_reason?.trim() || "model reported the field is not present in the document");
    }
    const ev = checkEvidence(parsedText, got.evidence);
    if (!ev.ok) return gap(`rejected: ${ev.reason}`);
    const normalizedValue = normalizeValue(def.type, got.value);
    if (normalizedValue == null) return gap(`rejected: value "${got.value}" is not a valid ${def.type}`);

    return {
      field: def.field,
      kind: "value",
      value: got.value,
      normalizedValue,
      evidence: got.evidence!,
      evidenceStart: ev.start,
      evidenceEnd: ev.end,
    };
  });
}
