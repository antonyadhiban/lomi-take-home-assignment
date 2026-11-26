import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIELDS, validateExtraction } from "@lomi/core";
import { describe, expect, it } from "vitest";
import { createFakeProvider, parsePdfText } from "./index.js";

const dir = path.resolve(import.meta.dirname, "../../../fixtures/documents");
const run = async (file: string, type: "invoice" | "lease" | "market_report") => {
  const text = await parsePdfText(new Uint8Array(await readFile(path.join(dir, file))));
  const out = await createFakeProvider().extract({ documentType: type, fields: FIELDS[type], text });
  return validateExtraction(FIELDS[type], out.fields, text);
};

describe("fake provider passes the real evidence validation on every fixture", () => {
  it.each([
    ["invoice-001.pdf", "invoice", 5, 0],
    ["invoice-001.v2.pdf", "invoice", 5, 0],
    ["lease-excerpt-001.pdf", "lease", 5, 0],
    ["market-report-excerpt-001.pdf", "market_report", 5, 1],
  ] as const)("%s", async (file, type, values, gaps) => {
    const v = await run(file, type);
    expect(v.filter((x) => x.kind === "value")).toHaveLength(values);
    expect(v.filter((x) => x.kind === "gap")).toHaveLength(gaps);
  });
});
