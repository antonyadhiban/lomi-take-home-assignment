import { normalizeText } from "./normalize.js";

export interface PriorValue {
  field: string;
  /** canonical value (normalizeValue) or null for a gap */
  normalizedValue: string | null;
  evidence: string | null;
}

export interface NewValue {
  field: string;
  normalizedValue: string | null;
  evidence: string | null;
}

export type CarryOverDecision =
  | { carry: true }
  | { carry: false; reason: "no_prior" | "gap" | "value_changed" | "evidence_changed" };

/**
 * A review carries over to the new version only when the thing the reviewer
 * actually looked at is still there and still says the same thing:
 *   1. both versions produced a real value (gaps always need fresh eyes),
 *   2. the canonical values are equal, and
 *   3. the prior version's evidence passage still appears verbatim in the
 *      new version's text.
 *
 * (3) is position-independent, so inserted paragraphs or reflowed layout don't
 * matter, and it doesn't depend on the LLM choosing the identical quote twice.
 */
export function decideCarryOver(
  prior: PriorValue | undefined,
  next: NewValue,
  nextParsedText: string,
): CarryOverDecision {
  if (!prior) return { carry: false, reason: "no_prior" };
  if (prior.normalizedValue == null || next.normalizedValue == null || !prior.evidence) {
    return { carry: false, reason: "gap" };
  }
  if (prior.normalizedValue !== next.normalizedValue) {
    return { carry: false, reason: "value_changed" };
  }
  if (!normalizeText(nextParsedText).includes(normalizeText(prior.evidence))) {
    return { carry: false, reason: "evidence_changed" };
  }
  return { carry: true };
}
