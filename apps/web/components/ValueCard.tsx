"use client";

import { useState, type FormEvent } from "react";
import { ValueBadge } from "@/components/StatusBadge";
import { fieldLabel, formatValue, timeAgo } from "@/lib/format";
import type { ReviewEvent, ReviewInput, Value } from "@/lib/types";

const KIND_LABEL: Record<ReviewEvent["kind"], string> = {
  approved: "Approved",
  corrected: "Corrected",
  restored: "Restored",
  carried_over: "Carried over",
};

function describe(e: ReviewEvent, v: Value) {
  if (e.state === "pending") return "Back to needs review";
  if (e.state === "corrected") return `${KIND_LABEL[e.kind]} → ${formatValue(v.type, e.resultValue)}`;
  return `${KIND_LABEL[e.kind]}${e.kind === "restored" ? " (approved)" : ""}`;
}

export function ValueCard({
  value: v,
  selected,
  readOnly,
  onSelect,
  onReview,
}: {
  value: Value;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onReview: (input: ReviewInput & { expectedLatestEventId?: string | null }) => Promise<unknown>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [redo, setRedo] = useState<string[]>([]); // event ids undone, most recent last
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (input: ReviewInput, keepRedo = false) => {
    setBusy(true);
    setError(null);
    try {
      await onReview({ ...input, expectedLatestEventId: v.latestEventId });
      if (!keepRedo) setRedo([]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Undo = re-apply the state before the latest event; redo = re-apply what was undone.
  // Both append events, so the audit trail stays complete.
  const latest = v.history.at(-1);
  const undo = async () => {
    if (!latest) return;
    const before = v.history.at(-2);
    const ok = await run(before ? { action: "restore", eventId: before.id } : { action: "reset" }, true);
    if (ok) setRedo((r) => [...r, latest.id]);
  };
  const redoLast = async () => {
    const id = redo.at(-1);
    if (!id) return;
    const ok = await run({ action: "restore", eventId: id }, true);
    if (ok) setRedo((r) => r.slice(0, -1));
  };

  const submitCorrection = async (e: FormEvent) => {
    e.preventDefault();
    if (await run({ action: "correct", value: draft, note: note || undefined })) {
      setCorrecting(false);
      setNote("");
    }
  };

  const corrected = v.status === "corrected" || (v.status === "carried_over" && v.history.at(-1)?.state === "corrected");

  return (
    <article id={`value-${v.id}`} className={`card card-pad value s-${v.isGap && v.status === "pending" ? "pending" : v.status} ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="value-head">
        <span className="field-name">{fieldLabel(v.field)}</span>
        <span className="row">
          {v.needsReReview && <span className="badge b-pending">Changed since v{v.previous!.versionNumber}</span>}
          {v.isGap && <span className="badge b-gap">Gap</span>}
          <ValueBadge status={v.status} />
        </span>
      </div>

      {v.isGap && !corrected ? (
        <p className="value-main gap">Not found</p>
      ) : (
        <p className="value-main">
          {corrected ? (
            <>
              <span className="human" title="Corrected by a reviewer">{formatValue(v.type, v.effectiveValue)}</span>
              {v.value != null && <span className="llm-struck" title="What the model extracted">{formatValue(v.type, v.value)}</span>}
            </>
          ) : (
            formatValue(v.type, v.value)
          )}
        </p>
      )}

      {v.evidence && <blockquote className="quote" title="Source passage (click to locate)">{v.evidence}</blockquote>}
      {v.isGap && v.gapReason && <p className="gap-reason">Why it&apos;s a gap: {v.gapReason}</p>}
      {v.note && <p className="note">Note: {v.note}</p>}

      {v.needsReReview && v.previous && (
        <div className="prev">
          <strong>In v{v.previous.versionNumber}:</strong>{" "}
          <span className="was">{formatValue(v.type, v.previous.effectiveValue ?? v.previous.value)}</span>{" "}
          <span className="muted">({v.previous.status.replace("_", " ")}{v.previous.note ? `, “${v.previous.note}”` : ""})</span>
          {v.previous.evidence && <div className="small muted">“{v.previous.evidence}”</div>}
        </div>
      )}
      {v.status === "carried_over" && <p className="small muted" style={{ margin: "0 0 8px" }}>Same value and source passage as the previous version, so its review was kept.</p>}

      {!readOnly && (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {v.status !== "approved" && (
            <button className="btn btn-approve btn-sm" disabled={busy} onClick={() => run({ action: "approve" })}>
              {v.isGap ? "Confirm absent" : "Approve"}
            </button>
          )}
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setDraft(v.effectiveValue ?? v.value ?? "");
              setCorrecting((c) => !c);
            }}
          >
            {v.isGap ? "Enter value" : "Correct"}
          </button>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" disabled={busy || !latest} onClick={undo} title="Undo last review action">
            ↶ Undo
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !redo.length} onClick={redoLast} title="Redo">
            ↷ Redo
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            History ({v.history.length})
          </button>
        </div>
      )}
      {readOnly && v.history.length > 0 && (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory((s) => !s)}>History ({v.history.length})</button>
        </div>
      )}

      {correcting && !readOnly && (
        <form className="correct-form" onSubmit={submitCorrection} onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <input type="text" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Correct ${v.type}`} aria-label="Corrected value" />
          </div>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>Save correction</button>
            <button type="button" className="btn btn-sm" onClick={() => setCorrecting(false)}>Cancel</button>
          </div>
        </form>
      )}

      {error && <p className="error-text small" style={{ margin: "8px 0 0" }}>{error}</p>}

      {showHistory && (
        <div className="history" onClick={(e) => e.stopPropagation()}>
          <ol>
            <li>
              <span>Extracted by model: {v.isGap ? "gap" : formatValue(v.type, v.value)}</span>
              {!readOnly && latest && (
                <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: "reset" })}>Restore</button>
              )}
            </li>
            {v.history.map((e, i) => (
              <li key={e.id} className={i === v.history.length - 1 ? "current" : undefined}>
                <span>
                  {describe(e, v)}
                  {e.note && <span className="muted"> · “{e.note}”</span>}
                  <span className="muted"> · {e.reviewer} · {timeAgo(e.createdAt)}</span>
                </span>
                {!readOnly && i !== v.history.length - 1 && (
                  <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: "restore", eventId: e.id })}>Restore</button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}
