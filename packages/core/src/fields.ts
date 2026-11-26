/**
 * Field definitions per document type. Mirrors fixtures/expected-fields.json;
 * kept in code so the API, worker and UI share one typed source.
 */
export type FieldType = "string" | "date" | "money" | "number" | "percent";
export type DocumentType = "invoice" | "lease" | "market_report";

export interface FieldDef {
  field: string;
  type: FieldType;
}

export const FIELDS: Record<DocumentType, readonly FieldDef[]> = {
  invoice: [
    { field: "invoice_number", type: "string" },
    { field: "issue_date", type: "date" },
    { field: "due_date", type: "date" },
    { field: "vendor_name", type: "string" },
    { field: "total_amount", type: "money" },
  ],
  lease: [
    { field: "tenant_name", type: "string" },
    { field: "monthly_rent", type: "money" },
    { field: "security_deposit", type: "money" },
    { field: "lease_start", type: "date" },
    { field: "term_months", type: "number" },
  ],
  market_report: [
    { field: "report_quarter", type: "string" },
    { field: "market_area", type: "string" },
    { field: "vacancy_rate", type: "percent" },
    { field: "average_rent_1br", type: "money" },
    { field: "year_over_year_rent_growth", type: "percent" },
    { field: "median_household_income", type: "money" },
  ],
};

export const DOCUMENT_TYPES = Object.keys(FIELDS) as DocumentType[];

export function isDocumentType(t: string): t is DocumentType {
  return (DOCUMENT_TYPES as string[]).includes(t);
}
