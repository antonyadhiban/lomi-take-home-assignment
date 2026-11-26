import { normalizeText } from "./normalize.js";

export type EvidenceCheck =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: string };

/**
 * Hallucination defense: the quoted evidence must appear verbatim (modulo
 * whitespace/unicode normalization) in the parsed text of THIS version.
 * Returns offsets into the normalized text so the UI can highlight it.
 */
export function checkEvidence(parsedText: string, evidence: string | null | undefined): EvidenceCheck {
  if (!evidence || normalizeText(evidence) === "") {
    return { ok: false, reason: "no evidence quoted" };
  }
  const haystack = normalizeText(parsedText);
  const needle = normalizeText(evidence);
  const start = haystack.indexOf(needle);
  if (start === -1) {
    return { ok: false, reason: "quoted evidence does not appear verbatim in the document text" };
  }
  return { ok: true, start, end: start + needle.length };
}
