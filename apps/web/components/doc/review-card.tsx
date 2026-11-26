"use client";

import { Check, History, PencilLine, Redo2, Undo2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Chip, Dot, VALUE_META, ValueStatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isOptimistic } from "@/hooks/use-review";
import { diffInline, documentLabel } from "@/lib/diff";
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

/**
 * The verification card: what the field is (canonical name + the document's
 * own label), its value, and the one passage it came from. For a value that
 * changed since the previous version, a single muted "was …" line plus the
 * same quote with the change marked inline replace the old multi-block diff.
 */
export function ReviewCard({
  value: v,
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
  const humanValue = latest?.state === "corrected";
  const status = displayStatus(v);
  const prev = v.previous;
  const changed = v.needsReReview && prev ? prev : null;
  const label = fieldLabel(v.field);
  const docLabel = documentLabel(v.evidence ?? prev?.evidence ?? null, label);
  const quote = changed && changed.evidence && v.evidence ? diffInline(changed.evidence, v.evidence) : null;
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
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground">{label}</span>
            {docLabel && <span> · “{docLabel}” in document</span>}
          </p>
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

      <div>
        {v.isGap && !humanValue ? (
          <p className="font-serif text-2xl leading-tight text-gap">Not found</p>
        ) : (
          <p className="font-serif text-[28px] leading-tight break-words">
            {humanValue ? (
              <>
                <span className="bg-corrected/12 px-1 text-corrected" title="Corrected by a reviewer">{formatValue(v.type, v.effectiveValue)}</span>
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
        {changed && (
          <p className="mt-1 text-xs text-muted-foreground">
            was <span className="text-foreground line-through decoration-muted-foreground/60">{formatValue(v.type, changed.effectiveValue ?? changed.value)}</span>{" "}
            · {VALUE_META[changed.status === "carried_over" ? "approved" : changed.status].label.toLowerCase()} in v{changed.versionNumber}
            {changed.note && <> · “{changed.note}”</>}
          </p>
        )}
        {v.note && !changed && <p className="mt-1 text-xs text-muted-foreground italic">“{v.note}”</p>}
      </div>

      {v.isGap ? (
        <p className="text-sm text-gap">{v.gapReason}</p>
      ) : (
        (quote || v.evidence) && (
          <blockquote className="border-l-2 border-border bg-background/60 px-3 py-2 text-[13px] leading-relaxed">
            {quote
              ? quote.map((p, i) => (
                  <span
                    key={i}
                    className={cn(
                      p.kind === "del" && "text-muted-foreground line-through decoration-gap/70",
                      p.kind === "add" && "bg-pending/15 px-0.5 text-foreground",
                    )}
                  >
                    {p.text}
                  </span>
                ))
              : v.evidence}
          </blockquote>
        )
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
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={showHistory}
            >
              <History className="size-3.5" /> {v.history.length}
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
        )
      )}

      {(showHistory || readOnly) && v.history.length > 0 && (
        <ol className="space-y-px border-l pl-3 text-xs">
          <li className="flex items-center justify-between gap-2 py-0.5">
            <span><span className="text-muted-foreground">Extracted · </span>{v.isGap ? "gap" : formatValue(v.type, v.value)}</span>
            {!readOnly && latest && (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onReview({ action: "reset" })} disabled={busy}>Restore</button>
            )}
          </li>
          {v.history.map((e, i) => (
            <li key={e.id} className={cn("flex items-center justify-between gap-2 py-0.5", i === v.history.length - 1 && "font-medium")}>
              <span className="min-w-0">
                <span className={VALUE_META[e.state === "pending" ? "pending" : e.state].text}>{e.kind === "undone" || e.kind === "redone" ? KIND[e.kind] : e.state === "pending" ? "Back to review" : KIND[e.kind]}</span>
                {e.state === "corrected" && <> → {formatValue(v.type, e.resultValue)}</>}
                <span className="text-muted-foreground"> · {e.reviewer} · {timeAgo(e.createdAt)}</span>
              </span>
              {!readOnly && i !== v.history.length - 1 && !isOptimistic(e.id) && (
                <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onReview({ action: "restore", eventId: e.id })} disabled={busy}>Restore</button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
