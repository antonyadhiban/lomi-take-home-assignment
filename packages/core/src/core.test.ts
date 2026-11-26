import { describe, expect, it } from "vitest";
import { checkEvidence, decideCarryOver, normalizeValue } from "./index.js";

const V1 = `INVOICE
Invoice Number: INV-2025-0847
Issue Date: 2025-09-14
Due Date: 2025-10-14
                                              Total Due:      $5,230.29`;

const V2 = `INVOICE (REVISED)
Invoice Number: INV-2025-0847
Issue Date: 2025-09-14
Due Date: 2025-11-13
                                              Total Due:      $6,126.45
This revised invoice supersedes the version issued on 2025-09-14 and`;

describe("checkEvidence", () => {
  it("accepts verbatim quotes regardless of layout whitespace", () => {
    expect(checkEvidence(V1, "Total Due: $5,230.29").ok).toBe(true);
  });
  it("rejects hallucinated or paraphrased quotes", () => {
    expect(checkEvidence(V1, "Total Due: $5,320.29").ok).toBe(false);
    expect(checkEvidence(V1, "total due: $5,230.29").ok).toBe(false);
    expect(checkEvidence(V1, "").ok).toBe(false);
  });
  it("validates against the version being extracted, not a later one", () => {
    expect(checkEvidence(V2, "Due Date: 2025-10-14").ok).toBe(false);
  });
});

describe("normalizeValue", () => {
  it("canonicalizes money, percent and dates", () => {
    expect(normalizeValue("money", "$5,230.29")).toBe("5230.29");
    expect(normalizeValue("money", "5230.29")).toBe("5230.29");
    expect(normalizeValue("percent", "4.2%")).toBe("4.2");
    expect(normalizeValue("date", "2025-09-14")).toBe("2025-09-14");
    expect(normalizeValue("money", "n/a")).toBeNull();
  });
});

describe("decideCarryOver (invoice v1 -> v2)", () => {
  const prior = (field: string, normalizedValue: string, evidence: string) => ({ field, normalizedValue, evidence });

  it("carries unchanged fields even if the LLM quotes a different passage in v2", () => {
    const d = decideCarryOver(
      prior("issue_date", "2025-09-14", "Issue Date: 2025-09-14"),
      { field: "issue_date", normalizedValue: "2025-09-14", evidence: "the version issued on 2025-09-14" },
      V2,
    );
    expect(d).toEqual({ carry: true });
  });

  it("sends changed values back to pending", () => {
    expect(
      decideCarryOver(
        prior("due_date", "2025-10-14", "Due Date: 2025-10-14"),
        { field: "due_date", normalizedValue: "2025-11-13", evidence: "Due Date: 2025-11-13" },
        V2,
      ),
    ).toEqual({ carry: false, reason: "value_changed" });
  });

  it("never carries a gap", () => {
    expect(
      decideCarryOver({ field: "x", normalizedValue: null, evidence: null }, { field: "x", normalizedValue: null, evidence: null }, V2),
    ).toEqual({ carry: false, reason: "gap" });
  });
});
