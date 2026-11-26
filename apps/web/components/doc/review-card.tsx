"use client";

import { replay } from "@lomi/core";
import { Check, History, PencilLine, Redo2, Undo2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Chip, Dot, VALUE_META, ValueStatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isOptimistic } from "@/hooks/use-review";
import { diffWords, documentLabel } from "@/lib/diff";
import { displayStatus, fieldLabel, formatValue, timeAgo } from "@/lib/format";
import type { ReviewEvent, ReviewInput, Value } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND: Record<ReviewEvent["kind"], string> = {
  approved: "Approved",
  corrected: "Corrected",
  restored: "Restored",
  carried_over: "Carried over",
  undone: "Undo",
  redone: "Redo",
};

export function ReviewCard({
  value: v,
  version,
  pageNumber,
  onLocate,
  pinned,
  readOnly,
  busy,
  correcting,
  setCorrecting,
  onReview,
  onUndo,
  onRedo,
  onClose,
}: {
  value: Value;
  version: number;
  pageNumber?: number;
  onLocate?: () => void;
  pinned: boolean;
  readOnly: boolean;
  busy: boolean;
  correcting: boolean;
  setCorrecting: (b: boolean) => void;
  onReview: (input: ReviewInput) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDraft(v.effectiveValue ?? v.value ?? "");
    setNote("");
  }, [v.id, correcting]);

  const latest = v.history.at(-1);
  const { done, redo } = replay(v.history);
  const steps = [...done, ...redo.slice().reverse()];
  const humanValue = latest?.state === "corrected";
  const status = displayStatus(v);
  const prev = v.previous;
  const changed = v.needsReReview && prev ? prev : null;
  const label = fieldLabel(v.field);
  const docLabel = documentLabel(v.evidence ?? prev?.evidence ?? null, label);
  const quote = changed && changed.evidence && v.evidence ? diffWords(changed.evidence, v.evidence) : null;
  const optimistic = isOptimistic(v.latestEventId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onReview({ action: "correct", value: draft.trim(), note: note.trim() || undefined });
    setCorrecting(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-xl leading-tight">{label}</h2>
          {docLabel && <p className="text-xs text-muted-foreground">“{docLabel}” in document</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {v.status === "carried_over" && <Chip title="Value and source passage unchanged from the previous version">Carried over from v{prev?.versionNumber ?? "–"}</Chip>}
          {v.isGap && (
            <Chip className="border-gap/40 text-gap">
              <Dot className="bg-gap" /> Gap
            </Chip>
          )}
          <ValueStatusChip status={status} />
          {pinned && (
            <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          )}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs text-muted-foreground">Extracted in v{version}</dt>
          <dd className="font-serif text-2xl break-words">{v.isGap ? "Not found" : formatValue(v.type, v.value)}</dd>
        </div>
        {humanValue && <div>
          <dt className="text-xs text-muted-foreground">Reviewer correction</dt>
          <dd className="font-serif text-2xl break-words text-corrected">{formatValue(v.type, v.effectiveValue)}</dd>
        </div>}
        {changed && <div>
          <dt className="text-xs text-muted-foreground">{VALUE_META[changed.status].label} in v{changed.versionNumber}</dt>
          <dd className="font-serif text-2xl text-muted-foreground">{changed.effectiveValue == null ? "Not found" : formatValue(v.type, changed.effectiveValue)}</dd>
          {changed.note && <dd className="text-xs text-muted-foreground">Reviewer note · {changed.note}</dd>}
        </div>}
      </dl>
      {v.note && <p className="text-xs">Reviewer note · {v.note}</p>}
      {v.isGap ? <p className="text-sm text-gap">{v.gapReason}</p> : v.evidence && (
        <div className="space-y-1 border-l-2 bg-background/60 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Source passage · v{version}{pageNumber != null && ` · Page ${pageNumber}`}</span>
            {onLocate && <button type="button" className="underline underline-offset-2" onClick={onLocate}>Show in document</button>}
          </div>
          <blockquote className="whitespace-pre-wrap text-sm">{v.evidence}</blockquote>
        </div>
      )}
      {quote && changed && changed.evidence !== v.evidence && (
        <details className="text-xs">
          <summary className="cursor-pointer">Compare passages</summary>
          {([[changed.versionNumber, quote.before], [version, quote.after]] as const).map(([number, parts]) => (
            <div key={number} className="mt-2 flex gap-2">
              <span className="font-mono text-muted-foreground">v{number}</span>
              <p className="whitespace-pre-wrap">{parts.map((part, i) => part.kind === "del"
                ? <del key={i} className="text-gap">{part.text}</del>
                : part.kind === "add" ? <ins key={i} className="text-approved">{part.text}</ins> : part.text)}</p>
            </div>
          ))}
        </details>
      )}

      {!readOnly && (
        correcting ? (
          <form onSubmit={submit} className="flex flex-wrap gap-2">
            <Input className="min-w-40 flex-1" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Correct ${v.type}`} aria-label="Corrected value" />
            <Input className="min-w-40 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
            <Button type="submit" size="sm" disabled={!draft.trim()}>Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCorrecting(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {status !== "approved" && (
              <Button size="sm" onClick={() => onReview({ action: "approve" })} disabled={busy}>
                <Check /> {v.isGap ? "Confirm absent" : "Approve"}
                <kbd className="ml-1 hidden text-[10px] opacity-60 sm:inline">A</kbd>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setCorrecting(true)} disabled={busy}>
              <PencilLine /> {v.isGap ? "Enter value" : "Correct"}
              <kbd className="ml-1 hidden text-[10px] opacity-60 sm:inline">C</kbd>
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={showHistory}
              >
                <History className="size-3.5" /> Step {done.length} of {steps.length}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Undo" onClick={onUndo} disabled={busy || optimistic || !v.canUndo}><Undo2 /></Button>
                </TooltipTrigger>
                <TooltipContent>Undo (U)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Redo" onClick={onRedo} disabled={busy || optimistic || !v.canRedo}><Redo2 /></Button>
                </TooltipTrigger>
                <TooltipContent>Redo (Shift+U)</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )
      )}

      {(showHistory || readOnly) && v.history.length > 0 && (
        <ol className="space-y-px border-l pl-3 text-xs">
          <li className="flex items-center justify-between gap-2 py-0.5">
            <span><span className="text-muted-foreground">Extracted · </span>{v.isGap ? "gap" : formatValue(v.type, v.value)}</span>
            {!readOnly && done.length > 0 && (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onReview({ action: "reset" })} disabled={busy}>Restore</button>
            )}
          </li>
          {steps.map((e) => (
            <li key={e.id} className={cn("flex items-center justify-between gap-2 py-0.5", e.id === done.at(-1)?.id && "font-medium")}>
              <span className="min-w-0">
                <span className={VALUE_META[e.state === "pending" ? "pending" : e.state].text}>{e.state === "pending" ? "Back to review" : KIND[e.kind]}</span>
                {e.id === done.at(-1)?.id && " · Current"}
                {e.state === "corrected" && <> → {formatValue(v.type, e.resultValue)}</>}
                <span className="text-muted-foreground"> · {e.reviewer} · {timeAgo(e.createdAt)}</span>
              </span>
              {!readOnly && e.id !== done.at(-1)?.id && !isOptimistic(e.id) && (
                <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onReview({ action: "restore", eventId: e.id })} disabled={busy}>Restore</button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
