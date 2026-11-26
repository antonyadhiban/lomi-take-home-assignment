/**
 * Model comparison for extraction. Runs every candidate model over every
 * fixture through the SAME pipeline the worker uses (unpdf text -> prompt ->
 * OpenRouter -> validateExtraction) and scores against eval/answer-key.json.
 *
 *   pnpm --filter @lomi/extraction eval [--models a,b] [--repeats 2]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { FIELDS, isDocumentType, validateExtraction, type ValidatedValue } from "@lomi/core";
import { createOpenRouterProvider, parsePdfText, PROMPT_VERSION } from "../src/index.js";
import { DEFAULT_MODELS } from "./models.js";

type Expected = string | string[] | null;
interface KeyDoc { file: string; type: string; expected: Record<string, Expected> }
type Outcome = "correct" | "correct_gap" | "wrong" | "missed" | "hallucinated";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    models: { type: "string" },
    repeats: { type: "string", default: "2" },
  },
});
const models = args.models ? args.models.split(",").map((s) => s.trim()) : DEFAULT_MODELS;
const repeats = Number(args.repeats);

const here = path.dirname(new URL(import.meta.url).pathname);
const fixturesDir = path.resolve(here, "../../../fixtures/documents");
const key = JSON.parse(await readFile(path.join(here, "answer-key.json"), "utf8")) as { documents: KeyDoc[] };

const texts = new Map<string, string>();
for (const d of key.documents) {
  texts.set(d.file, await parsePdfText(new Uint8Array(await readFile(path.join(fixturesDir, d.file)))));
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, "");
function score(expected: Expected, got: ValidatedValue): Outcome {
  if (expected === null) return got.kind === "gap" ? "correct_gap" : "hallucinated";
  if (got.kind === "gap") return "missed";
  const options = Array.isArray(expected) ? expected : [expected];
  return options.some((e) => loose(e) === loose(got.normalizedValue)) ? "correct" : "wrong";
}

interface FieldResult { file: string; field: string; repeat: number; outcome: Outcome; got: string | null; evidenceRejected: boolean; reason?: string }
interface ModelResult {
  model: string;
  fields: FieldResult[];
  errors: { file: string; repeat: number; message: string }[];
  calls: { latencyMs: number; costUsd: number | null; inputTokens: number; outputTokens: number }[];
}

async function runModel(model: string): Promise<ModelResult> {
  const provider = createOpenRouterProvider({ model });
  const res: ModelResult = { model, fields: [], errors: [], calls: [] };
  for (let r = 0; r < repeats; r++) {
    for (const doc of key.documents) {
      if (!isDocumentType(doc.type)) throw new Error(`bad type ${doc.type}`);
      const text = texts.get(doc.file)!;
      try {
        const out = await provider.extract({ documentType: doc.type, fields: FIELDS[doc.type], text });
        res.calls.push(out.usage);
        for (const v of validateExtraction(FIELDS[doc.type], out.fields, text)) {
          const outcome = score(doc.expected[v.field] ?? null, v);
          res.fields.push({
            file: doc.file,
            field: v.field,
            repeat: r,
            outcome,
            got: v.kind === "value" ? v.normalizedValue : null,
            evidenceRejected: v.kind === "gap" && v.gapReason.startsWith("rejected:"),
            reason: v.kind === "gap" ? v.gapReason : undefined,
          });
        }
      } catch (err) {
        res.errors.push({ file: doc.file, repeat: r, message: (err as Error).message });
      }
    }
  }
  process.stderr.write(`done: ${model}\n`);
  return res;
}

const results = await Promise.all(models.map(runModel));

// ---- summarize ----
const totalFields = key.documents.reduce((n, d) => n + Object.keys(d.expected).length, 0) * repeats;
const rows = results.map((r) => {
  const count = (o: Outcome) => r.fields.filter((f) => f.outcome === o).length;
  const ok = count("correct") + count("correct_gap");
  // consistency: share of (file, field) pairs where every repeat produced the same result
  const groups = new Map<string, Set<string>>();
  for (const f of r.fields) {
    const k = `${f.file}:${f.field}`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(f.got ?? "<gap>");
  }
  const consistent = [...groups.values()].filter((s) => s.size === 1).length / Math.max(groups.size, 1);
  const lat = r.calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const costs = r.calls.map((c) => c.costUsd).filter((c): c is number => c != null);
  return {
    model: r.model,
    accuracy: ok / totalFields,
    correct: ok,
    wrong: count("wrong"),
    missed: count("missed"),
    hallucinated: count("hallucinated"),
    evidenceRejected: r.fields.filter((f) => f.evidenceRejected).length,
    errors: r.errors.length,
    consistency: consistent,
    p50LatencyMs: lat[Math.floor(lat.length / 2)] ?? null,
    costPerDocUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
  };
});
rows.sort((a, b) => b.accuracy - a.accuracy || a.hallucinated - b.hallucinated || (a.costPerDocUsd ?? 9) - (b.costPerDocUsd ?? 9));

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const md: string[] = [
  `# Extraction model comparison`,
  ``,
  `Run: ${new Date().toISOString()} · prompt ${PROMPT_VERSION} · ${key.documents.length} fixtures × ${repeats} repeats = ${totalFields} field extractions per model.`,
  `Scored after the real pipeline's evidence validation, so a value with a non-verbatim quote counts as a gap.`,
  ``,
  `| Model | Accuracy | Wrong | Missed | Hallucinated | Evidence rejected | Errors | Consistency | p50 latency | $/doc |`,
  `|---|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) =>
    `| ${r.model} | ${pct(r.accuracy)} (${r.correct}/${totalFields}) | ${r.wrong} | ${r.missed} | ${r.hallucinated} | ${r.evidenceRejected} | ${r.errors} | ${pct(r.consistency)} | ${r.p50LatencyMs != null ? (r.p50LatencyMs / 1000).toFixed(1) + "s" : "–"} | ${r.costPerDocUsd != null ? "$" + r.costPerDocUsd.toFixed(5) : "–"} |`,
  ),
  ``,
  `**Columns:** *Wrong* = a value that doesn't match the key. *Missed* = a gap where the key has a value (including values dropped by evidence validation). *Hallucinated* = a value for a field the document doesn't contain (median_household_income). *Evidence rejected* = the model's quote wasn't verbatim, so the value was discarded.`,
  ``,
  `## Failures`,
  ``,
];
for (const r of results) {
  const bad = r.fields.filter((f) => f.outcome !== "correct" && f.outcome !== "correct_gap");
  if (!bad.length && !r.errors.length) continue;
  md.push(`### ${r.model}`);
  for (const f of bad) md.push(`- \`${f.file}\` · ${f.field} (run ${f.repeat + 1}): **${f.outcome}**, got ${f.got ?? "gap"}${f.reason ? ` · ${f.reason}` : ""}`);
  for (const e of r.errors) md.push(`- \`${e.file}\` (run ${e.repeat + 1}): **error** · ${e.message}`);
  md.push("");
}

await writeFile(path.join(here, "results", "latest.json"), JSON.stringify({ rows, results }, null, 2));
await writeFile(path.join(here, "RESULTS.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
