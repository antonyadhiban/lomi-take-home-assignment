import type { DocumentType, FieldDef, LlmField } from "@lomi/core";

export interface ExtractionResult {
  model: string;
  /** full prompt as sent, stored per run for debugging */
  prompt: string;
  /** raw provider response, stored per run for debugging */
  rawResponse: unknown;
  fields: LlmField[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null; latencyMs: number };
}

/**
 * The worker and tests depend only on this interface, so integration tests
 * use a fake provider and never call an LLM.
 */
export interface ExtractionProvider {
  readonly model: string;
  extract(input: { documentType: DocumentType; fields: readonly FieldDef[]; text: string }): Promise<ExtractionResult>;
}
