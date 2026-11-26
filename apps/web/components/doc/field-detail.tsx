"use client";

import { Check, History, PencilLine, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Chip, Dot, VALUE_META, ValueStatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isOptimistic } from "@/hooks/use-review";
import { diffWords, type DiffPart } from "@/lib/diff";
import { displayStatus, fieldLabel, formatValue, timeAgo } from "@/lib/format";
import type { ReviewEvent, ReviewInput, Value } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND: Record<ReviewEvent["kind"], string> = {
  approved: "Approved",
  corrected: "Corrected",
  restored: "Restored",
  carried_over: "Carried over",
};

function Quote({ parts, tone }: { parts: DiffPart[] | string; tone?: "before" | "after" }) {
  return (
    <blockquote className="border-l-2 border-border bg-card px-3 py-2 text-[13px] leading-relaxed">
      {typeof parts === "string"
        ? parts
        : parts.map((p, i) => (
            <span
              key={i}
              className={cn(
                p.kind === "del" && tone === "before" && "bg-gap/15 text-gap line-through decoration-gap/60",
                p.kind === "add" && tone === "after" && "bg-approved/15 text-approved",
              )}
            >
              {p.text}
            </span>
          ))}
    </blockquote>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/**
 * The focused field: its value (human correction highlighted over the model's
 * value), the evidence passage, what changed since the previous version, and
 * the review actions. Every action appends a review event.
 */
export function FieldDetail({
  value: v,
  readOnly,
  busy,
  redoCount,
  onReview,
  onUndo,
  onRedo,
  correcting,
  setCorrecting,
}: {
  value: Value;
  readOnly: boolean;
  busy: boolean;
  redoCount: number;
  onReview: (input: ReviewInput) => void;
  onUndo: () => void;
  onRedo: () => void;
  correcting: boolean;
  setCorrecting: (b: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDraft(v.effectiveValue ?? v.value ?? "");
    setNote("");
  }, [v.id, correcting]);

  const latest = v.history.at(-1);
  const humanValue = latest?.state === "corrected";
  const prev = v.previous;
  const changed = v.needsReReview && prev;
  const evDiff = changed && prev.evidence && v.evidence ? diffWords(prev.evidence, v.evidence) : null;
  const optimistic = isOptimistic(v.latestEventId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onReview({ action: "correct", value: draft.trim(), note: note.trim() || undefined });
    setCorrecting(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{fieldLabel(v.field)}</p>
          <div className="flex items-center gap-1.5">
            {v.isGap && (
              <Chip className="border-gap/40 text-gap">
                <Dot className="bg-gap" /> Gap
              </Chip>
            )}
            {v.status === "carried_over" && <Chip title="Value and source passage unchanged from the previous version">Carried over from v{prev?.versionNumber ?? "–"}</Chip>}
            <ValueStatusChip status={displayStatus(v)} />
          </div>
        </div>

        {v.isGap && !humanValue ? (
          <p className="font-serif text-2xl text-gap">Not found</p>
        ) : (
          <p className="font-serif text-[28px] leading-tight break-words">
            {humanValue ? (
              <>
                <span className="bg-corrected/12 px-1 text-corrected" title="Corrected by a reviewer">
                  {formatValue(v.type, v.effectiveValue)}
                </span>
                {v.value != null && (
                  <span className="ml-2 align-middle font-sans text-sm text-muted-foreground line-through" title="What the model extracted">
                    {formatValue(v.type, v.value)}
                  </span>
                )}
              </>
            ) : (
              formatValue(v.type, v.value)
            )}
          </p>
        )}
        {v.note && <p className="mt-1.5 text-xs text-muted-foreground italic">“{v.note}”</p>}
        {v.status === "carried_over" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Same value and source passage as v{prev?.versionNumber ?? "–"}, so its review was kept.
          </p>
        )}
      </div>

      {changed ? (
        <div className="space-y-3">
          <SectionLabel>Changed since v{prev.versionNumber}</SectionLabel>
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="text-xs text-muted-foreground">v{prev.versionNumber}</span>
            <span className="text-muted-foreground line-through">{formatValue(v.type, prev.effectiveValue ?? prev.value)}</span>
            <span className="text-xs text-muted-foreground">now</span>
            <span className="font-medium">{v.isGap ? "Not found" : formatValue(v.type, v.value)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            v{prev.versionNumber} was <span className="text-foreground">{VALUE_META[prev.status].label.toLowerCase()}</span>
            {prev.note && <> with note “{prev.note}”</>}.{" "}
            {v.status === "pending"
              ? "Its evidence no longer matches, so it needs a fresh look."
              : "Its evidence changed in this version and it has been reviewed again."}
          </p>
          {evDiff ? (
            <div className="space-y-1.5">
              <Quote parts={evDiff.before} tone="before" />
              <Quote parts={evDiff.after} tone="after" />
            </div>
          ) : (
            prev.evidence && <Quote parts={prev.evidence} />
          )}
        </div>
      ) : (
        <div>
          <SectionLabel>{v.isGap ? "Why it's a gap" : "Source passage"}</SectionLabel>
          {v.isGap ? <p className="text-sm text-gap">{v.gapReason}</p> : v.evidence && <Quote parts={v.evidence} />}
        </div>
      )}

      {!readOnly && (
        <div className="space-y-3">
          {correcting ? (
            <form onSubmit={submit} className="space-y-2">
              <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Correct ${v.type}`} aria-label="Corrected value" />
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={!draft.trim()}>
                  Save correction
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCorrecting(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {displayStatus(v) !== "approved" && (
                <Button size="sm" onClick={() => onReview({ action: "approve" })} disabled={busy}>
                  <Check /> {v.isGap ? "Confirm absent" : "Approve"}
                  <kbd className="ml-1 hidden text-[10px] opacity-60 sm:inline">A</kbd>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setCorrecting(true)} disabled={busy}>
                <PencilLine /> {v.isGap ? "Enter value" : "Correct"}
                <kbd className="ml-1 hidden text-[10px] opacity-60 sm:inline">C</kbd>
              </Button>
              <div className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Undo" onClick={onUndo} disabled={busy || optimistic || !latest}>
                    <Undo2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo (U)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Redo" onClick={onRedo} disabled={busy || optimistic || !redoCount}>
                    <Redo2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Redo (Shift+U)</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowHistory((s) => !s)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={showHistory}
        >
          <History className="size-3.5" /> History · {v.history.length} event{v.history.length === 1 ? "" : "s"}
        </button>
        {showHistory && (
          <ol className="mt-2 space-y-px border-l pl-3 text-xs">
            <li className="flex items-center justify-between gap-2 py-1">
              <span>
                <span className="text-muted-foreground">Extracted · </span>
                {v.isGap ? "gap" : formatValue(v.type, v.value)}
              </span>
              {!readOnly && latest && (
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onReview({ action: "reset" })} disabled={busy}>
                  Restore
                </button>
              )}
            </li>
            {v.history.map((e, i) => (
              <li key={e.id} className={cn("flex items-center justify-between gap-2 py-1", i === v.history.length - 1 && "font-medium")}>
                <span className="min-w-0">
                  <span className={cn(VALUE_META[e.state === "pending" ? "pending" : e.state].text)}>
                    {e.state === "pending" ? "Back to review" : KIND[e.kind]}
                  </span>
                  {e.state === "corrected" && <> → {formatValue(v.type, e.resultValue)}</>}
                  <span className="text-muted-foreground">
                    {" "}
                    · {e.reviewer} · {timeAgo(e.createdAt)}
                  </span>
                </span>
                {!readOnly && i !== v.history.length - 1 && !isOptimistic(e.id) && (
                  <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onReview({ action: "restore", eventId: e.id })} disabled={busy}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
