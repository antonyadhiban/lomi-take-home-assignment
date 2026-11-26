import { createRedis, EXTRACTION_QUEUE } from "@lomi/queue";
import { Worker } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addVersion,
  applyReview,
  createDocument,
  getDocument,
  getProgress,
  MAX_CLAIMS,
  processRun,
  reconcile,
  retryExtraction,
} from "../src/index.js";
import { activeRunId, deferred, fakeInvoiceProvider, fixture, makeDeps, resetDb } from "./helpers.js";

const provider = fakeInvoiceProvider();
const deps = await makeDeps(provider);
afterAll(() => deps.close());
beforeEach(() => resetDb(deps));

const upload = async () => {
  const doc = await createDocument(deps, { id: "inv", type: "invoice", title: "Invoice", file: await fixture("invoice-001.pdf") });
  return doc.id;
};
const countValues = (versionId?: string) => deps.prisma.extractedValue.count(versionId ? { where: { versionId } } : undefined);

describe("upload", () => {
  it("returns immediately with a queued run recorded in Postgres", async () => {
    const id = await upload();
    const doc = await getDocument(deps, id);
    expect(doc.status).toBe("queued");
    expect(doc.values).toEqual([]);
    expect(await deps.queue.getJob(await activeRunId(deps, id))).toBeTruthy();
  });

  it("rejects non-PDFs and unknown types", async () => {
    await expect(createDocument(deps, { type: "invoice", file: new TextEncoder().encode("hello") })).rejects.toThrow(/not a PDF/);
    await expect(createDocument(deps, { type: "receipt", file: await fixture("invoice-001.pdf") })).rejects.toThrow(/unknown document type/);
  });
});

describe("processRun", () => {
  it("extracts values with verbatim evidence and stores parsed text, prompt and raw response", async () => {
    const id = await upload();
    expect(await processRun(deps, await activeRunId(deps, id))).toBe("succeeded");
    const doc = await getDocument(deps, id);
    expect(doc.status).toBe("extracted");
    expect(doc.values.map((v) => [v.field, v.value])).toEqual([
      ["invoice_number", "INV-2025-0847"],
      ["issue_date", "2025-09-14"],
      ["due_date", "2025-10-14"],
      ["vendor_name", "MERIDIAN OFFICE SUPPLIES LLC"],
      ["total_amount", "$5,230.29"],
    ]);
    for (const v of doc.values) expect(doc.version.parsedText).toContain(v.evidence);
    const run = await deps.prisma.extractionRun.findFirstOrThrow();
    expect(run.prompt).toBe("fake prompt");
    expect(run.rawResponse).toBeTruthy();
  });

  it("is idempotent: processing the same run twice, or concurrently, never duplicates values", async () => {
    const id = await upload();
    const runId = await activeRunId(deps, id);
    const outcomes = await Promise.all([processRun(deps, runId), processRun(deps, runId)]);
    expect(outcomes.sort()).toEqual(["skipped", "succeeded"]);
    expect(await processRun(deps, runId)).toBe("skipped");
    expect(await countValues()).toBe(5);
  });

  it("stores hallucinated evidence as a gap with a reason, never as a value", async () => {
    const lying = fakeInvoiceProvider((fields) =>
      fields.map((f) => (f.field === "total_amount" ? { ...f, value: "$9,999.00", evidence: "Total Due: $9,999.00" } : f)),
    );
    const d = { ...deps, provider: lying };
    const id = await upload();
    await processRun(d, await activeRunId(d, id));
    const total = (await getDocument(d, id)).values.find((v) => v.field === "total_amount")!;
    expect(total).toMatchObject({ isGap: true, value: null });
    expect(total.gapReason).toMatch(/verbatim/);
  });

  it("turns an LLM failure into a visible, retryable failed state", async () => {
    const broken = { model: "x", extract: async () => { throw new Error("LLM timed out"); } };
    const id = await upload();
    expect(await processRun({ ...deps, provider: broken }, await activeRunId(deps, id))).toBe("failed");
    let doc = await getDocument(deps, id);
    expect(doc.status).toBe("failed");
    expect(doc.version.error).toMatch(/LLM timed out/);

    await expect(retryExtraction(deps, id)).resolves.toBeUndefined();
    await expect(retryExtraction(deps, id)).rejects.toThrow(/only failed versions/); // impatient double retry
    expect(await processRun(deps, await activeRunId(deps, id))).toBe("succeeded");
    doc = await getDocument(deps, id);
    expect(doc.status).toBe("extracted");
    expect(doc.version.lastRun?.attempt).toBe(2);
  });

  it("recovers a run whose worker died mid-extraction (expired lease)", async () => {
    const id = await upload();
    const runId = await activeRunId(deps, id);
    // simulate: a worker claimed it, then the container was killed
    await deps.prisma.extractionRun.update({
      where: { id: runId },
      data: { status: "running", claimToken: "dead-worker", claims: 1, leaseUntil: new Date(Date.now() - 1000) },
    });
    expect(await processRun(deps, runId)).toBe("succeeded");
    expect(await countValues()).toBe(5);
  });

  it("does not steal a run whose lease is still live", async () => {
    const id = await upload();
    const runId = await activeRunId(deps, id);
    await deps.prisma.extractionRun.update({
      where: { id: runId },
      data: { status: "running", claimToken: "alive", claims: 1, leaseUntil: new Date(Date.now() + 60_000) },
    });
    expect(await processRun(deps, runId)).toBe("skipped");
  });

  it("fails (retryably) instead of crash-looping forever", async () => {
    const id = await upload();
    const runId = await activeRunId(deps, id);
    await deps.prisma.extractionRun.update({
      where: { id: runId },
      data: { status: "running", claims: MAX_CLAIMS, leaseUntil: new Date(Date.now() - 1000) },
    });
    expect(await processRun(deps, runId)).toBe("failed");
    expect((await getDocument(deps, id)).status).toBe("failed");
  });

  it("rejects a stale commit after its lease was taken over", async () => {
    const gate = deferred();
    const slow = fakeInvoiceProvider();
    const slowProvider = { model: slow.model, extract: async (i: Parameters<typeof slow.extract>[0]) => { await gate.promise; return slow.extract(i); } };
    const id = await upload();
    const runId = await activeRunId(deps, id);
    const first = processRun({ ...deps, provider: slowProvider }, runId);
    await new Promise((r) => setTimeout(r, 200));
    // lease expires while the first worker is stuck in the LLM call; another worker takes over
    await deps.prisma.extractionRun.update({ where: { id: runId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    expect(await processRun(deps, runId)).toBe("succeeded");
    gate.resolve();
    expect(await first).toBe("skipped");
    expect(await countValues()).toBe(5);
  });
});

describe("re-extraction and carry-over (invoice v1 -> v2)", () => {
  it("keeps reviews whose evidence is unchanged and re-queues exactly the changed values", async () => {
    const id = await upload();
    await processRun(deps, await activeRunId(deps, id));
    const v1 = await getDocument(deps, id);
    const byField = (doc: typeof v1, f: string) => doc.values.find((v) => v.field === f)!;
    for (const v of v1.values) await applyReview(deps, v.id, { action: "approve" });
    await applyReview(deps, byField(v1, "vendor_name").id, { action: "correct", value: "Meridian Office Supplies LLC", note: "title case" });

    await addVersion(deps, id, await fixture("invoice-001.v2.pdf"));
    expect(await processRun(deps, await activeRunId(deps, id))).toBe("succeeded");

    const v2 = await getDocument(deps, id);
    expect(v2.currentVersion).toBe(2);
    expect(Object.fromEntries(v2.values.map((v) => [v.field, v.status]))).toEqual({
      invoice_number: "carried_over",
      issue_date: "carried_over",
      due_date: "pending",
      vendor_name: "carried_over",
      total_amount: "pending",
    });
    // the correction carries over too, and changed values show what they replaced
    expect(byField(v2, "vendor_name")).toMatchObject({ effectiveValue: "Meridian Office Supplies LLC", note: "title case" });
    expect(byField(v2, "total_amount")).toMatchObject({
      value: "$6,126.45",
      needsReReview: true,
      previous: { versionNumber: 1, value: "$5,230.29", status: "approved" },
    });
    expect(await getProgress(deps, id)).toMatchObject({ pending: 2, carried_over: 3, approved: 0, corrected: 0 });

    // nothing from v1 is lost, and it is evaluated against v1's own text
    const old = await getDocument(deps, id, 1);
    expect(old.version.isCurrent).toBe(false);
    expect(byField(old, "total_amount")).toMatchObject({ value: "$5,230.29", status: "approved" });
    expect(old.version.parsedText).toContain("Total Due: $5,230.29");
  });

  it("re-uploading identical bytes is a no-op", async () => {
    const id = await upload();
    const res = await addVersion(deps, id, await fixture("invoice-001.pdf"));
    expect(res.duplicate).toBe(true);
    expect(await deps.prisma.documentVersion.count()).toBe(1);
  });
});

describe("new version while the previous one is still extracting (supersede)", () => {
  it("supersedes a queued version; its job becomes a no-op", async () => {
    const id = await upload();
    const v1Run = await activeRunId(deps, id);
    await addVersion(deps, id, await fixture("invoice-001.v2.pdf"));
    expect(await processRun(deps, v1Run)).toBe("skipped");
    expect(await processRun(deps, await activeRunId(deps, id))).toBe("succeeded");
    const doc = await getDocument(deps, id);
    expect(doc.versions.map((v) => [v.version, v.status])).toEqual([[1, "superseded"], [2, "extracted"]]);
    expect(doc.values.every((v) => v.status === "pending")).toBe(true); // nothing extracted to carry from
  });

  it("discards the result of a version superseded mid-LLM-call", async () => {
    const gate = deferred();
    const slow = fakeInvoiceProvider();
    const slowProvider = { model: slow.model, extract: async (i: Parameters<typeof slow.extract>[0]) => { await gate.promise; return slow.extract(i); } };
    const id = await upload();
    const v1 = processRun({ ...deps, provider: slowProvider }, await activeRunId(deps, id));
    await new Promise((r) => setTimeout(r, 200));
    await addVersion(deps, id, await fixture("invoice-001.v2.pdf"));
    gate.resolve();
    expect(await v1).toBe("cancelled");
    const v1Version = await deps.prisma.documentVersion.findFirstOrThrow({ where: { version: 1 } });
    expect(await countValues(v1Version.id)).toBe(0);
  });
});

describe("reconciler (Redis is not the source of truth)", () => {
  it("re-enqueues queued and orphaned runs after Redis loses everything, exactly once", async () => {
    const id = await upload();
    const runId = await activeRunId(deps, id);
    await deps.queue.obliterate({ force: true }); // same effect as FLUSHALL for this queue
    // age the run past the grace period
    await deps.prisma.extractionRun.update({ where: { id: runId }, data: { createdAt: new Date(Date.now() - 60_000) } });

    expect((await reconcile(deps)).enqueued).toEqual([runId]);
    expect((await reconcile(deps)).enqueued).toEqual([]); // job already waiting
    expect(await deps.queue.getJob(runId)).toBeTruthy();
    expect(await processRun(deps, runId)).toBe("succeeded");
  });

  it("re-enqueues a run stuck in `running` whose worker died, even if BullMQ kept a finished job", async () => {
    const id = await upload();
    const runId = await activeRunId(deps, id);
    // a real BullMQ worker picks the job up and dies with it (job ends `failed`)
    const conn = createRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    const failedOnce = deferred();
    const w = new Worker(EXTRACTION_QUEUE, async () => { throw new Error("worker killed"); }, { connection: conn, prefix: deps.prefix });
    w.on("failed", () => failedOnce.resolve());
    await failedOnce.promise;
    await w.close();
    conn.disconnect();
    expect(await (await deps.queue.getJob(runId))!.getState()).toBe("failed");
    await deps.prisma.extractionRun.update({
      where: { id: runId },
      data: { status: "running", claims: 1, leaseUntil: new Date(Date.now() - 1000) },
    });
    expect((await reconcile(deps)).enqueued).toEqual([runId]);
  });
});

describe("reviews", () => {
  it("are append-only, validate corrections, support restore/reset, and refuse old versions", async () => {
    const id = await upload();
    await processRun(deps, await activeRunId(deps, id));
    const total = (await getDocument(deps, id)).values.find((v) => v.field === "total_amount")!;

    await expect(applyReview(deps, total.id, { action: "correct", value: "lots" })).rejects.toThrow(/not a valid money/);
    const approved = await applyReview(deps, total.id, { action: "approve" });
    await applyReview(deps, total.id, { action: "correct", value: "5320.29", note: "per vendor" });
    await expect(
      applyReview(deps, total.id, { action: "approve", expectedLatestEventId: approved.id }),
    ).rejects.toThrow(/someone else/);
    await applyReview(deps, total.id, { action: "restore", eventId: approved.id }); // undo
    let v = (await getDocument(deps, id)).values.find((x) => x.field === "total_amount")!;
    expect(v).toMatchObject({ status: "approved", effectiveValue: "$5,230.29", value: "$5,230.29" });
    expect(v.history.map((h) => h.kind)).toEqual(["approved", "corrected", "restored"]);

    await applyReview(deps, total.id, { action: "reset" });
    v = (await getDocument(deps, id)).values.find((x) => x.field === "total_amount")!;
    expect(v.status).toBe("pending");

    await addVersion(deps, id, await fixture("invoice-001.v2.pdf"));
    await expect(applyReview(deps, total.id, { action: "approve" })).rejects.toThrow(/current, extracted version/);
  });

  it("undo/redo are stored events: the redo stack survives a reload and clears on a new action", async () => {
    const id = await upload();
    await processRun(deps, await activeRunId(deps, id));
    const get = async () => (await getDocument(deps, id)).values.find((x) => x.field === "total_amount")!;
    const total = await get();

    await applyReview(deps, total.id, { action: "approve" });
    await applyReview(deps, total.id, { action: "correct", value: "5320.29" });
    await applyReview(deps, total.id, { action: "undo" });
    let v = await get(); // a fresh read is what a reload sees
    expect(v).toMatchObject({ status: "approved", effectiveValue: "$5,230.29", canUndo: true, canRedo: true });

    await applyReview(deps, total.id, { action: "redo" });
    v = await get();
    expect(v).toMatchObject({ status: "corrected", effectiveValue: "5320.29", canRedo: false });

    await applyReview(deps, total.id, { action: "undo" });
    await applyReview(deps, total.id, { action: "undo" });
    v = await get();
    expect(v).toMatchObject({ status: "pending", canUndo: false, canRedo: true });
    await expect(applyReview(deps, total.id, { action: "undo" })).rejects.toThrow(/nothing to undo/);

    await applyReview(deps, total.id, { action: "approve" }); // new action
    v = await get();
    expect(v.canRedo).toBe(false);
    expect(v.history.map((h) => h.kind)).toEqual(["approved", "corrected", "undone", "redone", "undone", "undone", "approved"]);
  });
});
