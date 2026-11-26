import { describe, expect, it } from "vitest";
import { FIELDS, validateExtraction } from "./index.js";

const TEXT = `Reporting Period: Q3 2025
The overall vacancy rate declined to 4.2%, down from
4.9% in the prior quarter.`;

const defs = FIELDS.market_report;

describe("validateExtraction", () => {
  it("keeps values whose evidence is verbatim, even across line breaks", () => {
    const [v] = validateExtraction(
      defs.filter((d) => d.field === "vacancy_rate"),
      [{ field: "vacancy_rate", value: "4.2", evidence: "vacancy rate declined to 4.2%, down from 4.9%", gap_reason: null }],
      TEXT,
    );
    expect(v).toMatchObject({ kind: "value", normalizedValue: "4.2" });
  });

  it("turns hallucinated evidence into a gap, never a value", () => {
    const [v] = validateExtraction(
      defs.filter((d) => d.field === "median_household_income"),
      [{ field: "median_household_income", value: "84000", evidence: "Median household income: $84,000", gap_reason: null }],
      TEXT,
    );
    expect(v).toMatchObject({ kind: "gap", rejectedValue: "84000" });
    expect(v!.kind === "gap" && v!.gapReason).toMatch(/verbatim/);
  });

  it("emits exactly one entry per expected field, filling missing ones with gaps", () => {
    const out = validateExtraction(defs, [{ field: "bogus", value: "x", evidence: "Q3", gap_reason: null }], TEXT);
    expect(out.map((o) => o.field)).toEqual(defs.map((d) => d.field));
    expect(out.every((o) => o.kind === "gap")).toBe(true);
  });

  it("keeps the model's own reason for a gap", () => {
    const [v] = validateExtraction(
      defs.filter((d) => d.field === "median_household_income"),
      [{ field: "median_household_income", value: null, evidence: null, gap_reason: "not mentioned in the report" }],
      TEXT,
    );
    expect(v).toMatchObject({ kind: "gap", gapReason: "not mentioned in the report" });
  });

  it("rejects values that don't parse as the field type", () => {
    const [v] = validateExtraction(
      defs.filter((d) => d.field === "vacancy_rate"),
      [{ field: "vacancy_rate", value: "low", evidence: "Q3 2025", gap_reason: null }],
      TEXT,
    );
    expect(v).toMatchObject({ kind: "gap" });
  });
});
