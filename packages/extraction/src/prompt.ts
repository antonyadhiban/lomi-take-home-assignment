import type { DocumentType, FieldDef, FieldType } from "@lomi/core";

export const PROMPT_VERSION = "v1";

const FORMAT: Record<FieldType, string> = {
  string: "the text as written in the document",
  date: "ISO date YYYY-MM-DD",
  money: "a plain number without currency symbols or thousands separators, e.g. 5230.29",
  number: "a plain number, e.g. 24 (convert words like 'twenty-four' to digits)",
  percent: "a plain number without the % sign, e.g. 4.2",
};

export const SYSTEM_PROMPT = `You extract structured fields from business documents for a human review queue.

Rules:
1. Only report a value that is explicitly stated in the document. Never infer, compute, estimate, or use outside knowledge.
2. For every value, "evidence" must be copied EXACTLY, character for character, from the document text: one contiguous passage (ideally the label and the value, or the shortest full clause that contains the value). Do not paraphrase, reorder, fix typos, or join separate passages. Evidence is checked mechanically; anything not found verbatim is discarded.
3. If a field is not explicitly present, set value and evidence to null and give a short gap_reason (e.g. "not mentioned in the document").
4. When the document mentions several candidate numbers (e.g. current vs prior period, actual vs forecast), report the one the field asks for: the current/primary figure for the document's own period.
5. Return every requested field exactly once.`;

export function buildUserPrompt(documentType: DocumentType, fields: readonly FieldDef[], text: string): string {
  const list = fields.map((f) => `- ${f.field} (${f.type}): ${FORMAT[f.type]}`).join("\n");
  return `Document type: ${documentType}

Fields to extract:
${list}

Document text:
<<<DOCUMENT
${text}
DOCUMENT>>>`;
}

/** JSON schema for strict structured output; field names are an enum per document type. */
export function responseSchema(fields: readonly FieldDef[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["fields"],
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "value", "evidence", "gap_reason"],
          properties: {
            field: { type: "string", enum: fields.map((f) => f.field) },
            value: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
            gap_reason: { type: ["string", "null"] },
          },
        },
      },
    },
  } as const;
}
