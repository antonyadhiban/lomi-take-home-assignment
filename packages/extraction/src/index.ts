import type { DocumentType, FieldDef } from "@lomi/core";

/**
 * Extraction contract. The real OpenRouter provider and the model-comparison
 * eval land in the next step; the worker and tests depend only on this
 * interface, so tests can use a fake provider and never call an LLM.
 */
export interface RawExtractedField {
  field: string;
  value: string | null;
  evidence: string | null;
  gapReason: string | null;
}

export interface ExtractionResult {
  model: string;
  prompt: string;
  rawResponse: unknown;
  fields: RawExtractedField[];
}

export interface ExtractionProvider {
  extract(input: { documentType: DocumentType; fields: readonly FieldDef[]; text: string }): Promise<ExtractionResult>;
}

export async function parsePdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
