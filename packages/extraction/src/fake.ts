import type { DocumentType, LlmField } from "@lomi/core";
import type { ExtractionProvider } from "./types.js";

/**
 * Deterministic stand-in for the LLM, for end-to-end tests and offline demos
 * (EXTRACTION_PROVIDER=fake). It reads the fixture documents with fixed
 * patterns and quotes the matching passage, so everything downstream
 * (evidence validation, carry-over, reviews) runs exactly as in production.
 * Fields it can't find come back as gaps, like a well-behaved model.
 */
const PATTERNS: Record<DocumentType, Record<string, RegExp>> = {
  invoice: {
    invoice_number: /Invoice Number: (\S+)/,
    issue_date: /Issue Date: (\S+)/,
    due_date: /Due Date: (\S+)/,
    vendor_name: /^([A-Z][A-Z ]+ LLC)$/m,
    total_amount: /Total Due: (\$[\d,.]+)/,
  },
  lease: {
    tenant_name: /(Dana Okafor) \("Tenant"\)/,
    monthly_rent: /monthly rent of (\$[\d,.]+\d)/,
    security_deposit: /the sum of (\$[\d,.]+\d)/,
    lease_start: /commencing on ([A-Z][a-z]+ \d{1,2}, \d{4})/,
    term_months: /\((\d+)\)\s+months/,
  },
  market_report: {
    report_quarter: /Reporting Period: (Q\d \d{4})/,
    market_area: /Market Area: (.+)/,
    vacancy_rate: /vacancy rate declined to (\d+(?:\.\d+)?)%/,
    average_rent_1br: /one-bedroom unit reached (\$[\d,]+)/,
    year_over_year_rent_growth: /year-over-year increase of (\d+(?:\.\d+)?)%/,
    median_household_income: /median household income of (\$[\d,]+)/i,
  },
};

export function createFakeProvider(): ExtractionProvider {
  return {
    model: "fake/deterministic",
    async extract({ documentType, fields, text }) {
      const out: LlmField[] = fields.map(({ field }) => {
        const m = PATTERNS[documentType]?.[field]?.exec(text);
        return m
          ? { field, value: m[1]!.trim(), evidence: m[0], gap_reason: null }
          : { field, value: null, evidence: null, gap_reason: "not mentioned in the document" };
      });
      return {
        model: "fake/deterministic",
        prompt: `fake provider: ${documentType}`,
        rawResponse: { fields: out },
        fields: out,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
      };
    },
  };
}
