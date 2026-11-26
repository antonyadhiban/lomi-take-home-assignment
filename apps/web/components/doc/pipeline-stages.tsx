"use client";

import { AlertTriangle, Check, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Progress } from "@/lib/types";
import { cn } from "@/lib/utils";

export type StageState = "waiting" | "active" | "done" | "failed";

export interface ReviewStage {
  progress: Progress; // display progress (carried over counted as approved)
  changed: number;
  previousVersion: number | null;
  readOnlyNote?: string;
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "active") return <Loader2 className="size-3 animate-spin" />;
  if (state === "done") return <Check className="size-3" />;
  if (state === "failed") return <AlertTriangle className="size-3 text-gap" />;
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" />;
}

function Bar({ state }: { state: StageState }) {
  return (
    <div className="relative h-6 overflow-hidden bg-muted">
      {state === "done" && <div className="absolute inset-0 bg-foreground/85" />}
      {state === "failed" && <div className="absolute inset-0 bg-gap/25" />}
      {state === "active" && (
        <div className="absolute inset-0 animate-pulse bg-[repeating-linear-gradient(135deg,var(--foreground)_0_1px,transparent_1px_6px)] opacity-40" />
      )}
    </div>
  );
}

/**
 * Upload → Extract → Review, always in the same place and the same height,
 * so nothing shifts as a document moves through the pipeline. The review
 * stage is the progress bar itself, with the count inside; hover for the
 * breakdown.
 */
export function PipelineStages({
  upload,
  extract,
  review,
  version,
  error,
  onRetry,
  retrying,
  statusNode,
}: {
  upload: StageState;
  extract: StageState;
  review: ReviewStage | null;
  version: number | null;
  error?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  /** replaces the default status line (e.g. "viewing v1, read-only · back to v2") */
  statusNode?: React.ReactNode;
}) {
  const p = review?.progress;
  const reviewed = p ? p.total - p.pending : 0;
  const reviewState: StageState = !p ? "waiting" : p.pending === 0 ? "done" : "active";
  const label = (name: string, state: StageState, extra?: string) => (
    <p className={cn("flex h-4 items-center gap-1.5 text-[11px]", state === "waiting" ? "text-muted-foreground/60" : "text-muted-foreground")}>
      <StageIcon state={state} />
      {name}
      {extra && <span className="text-muted-foreground/70">{extra}</span>}
    </p>
  );

  return (
    <div className="border-b px-4 pt-3 pb-3">
      <div className="grid grid-cols-[1fr_1fr_2.4fr] gap-1.5">
        <div className="space-y-1.5">
          {label(upload === "active" ? "Uploading" : "Upload", upload, version ? `v${version}` : undefined)}
          <Bar state={upload} />
        </div>
        <div className="space-y-1.5">
          {label(extract === "active" ? "Extracting" : "Extract", extract)}
          <Bar state={extract} />
        </div>
        <div className="space-y-1.5">
          {label("Review", reviewState, review?.readOnlyNote)}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative flex h-6 cursor-default overflow-hidden bg-muted" aria-label={p ? `${reviewed} of ${p.total} reviewed` : "Waiting for extraction"}>
                {p && p.total > 0 && (
                  <>
                    <span className="bg-approved/85" style={{ width: `${(p.approved / p.total) * 100}%` }} />
                    <span className="bg-corrected/85" style={{ width: `${(p.corrected / p.total) * 100}%` }} />
                  </>
                )}
                <span className="absolute inset-0 flex items-center justify-between px-2 text-[11px] font-medium tabular-nums">
                  {p ? (
                    <>
                      <span className={cn(reviewed > 0 && "text-background mix-blend-normal")}>
                        {p.pending ? `${p.pending} to review` : "All reviewed"}
                      </span>
                      <span className="bg-background/85 px-1 text-muted-foreground">
                        {reviewed}/{p.total}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </span>
              </div>
            </TooltipTrigger>
            {p && (
              <TooltipContent side="bottom" align="end" className="text-xs">
                <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                  <span>To review</span><span className="text-right tabular-nums">{p.pending}</span>
                  {review.changed > 0 && (<><span>Changed since v{review.previousVersion}</span><span className="text-right tabular-nums">{review.changed}</span></>)}
                  <span>Approved</span><span className="text-right tabular-nums">{p.approved}</span>
                  <span>Corrected</span><span className="text-right tabular-nums">{p.corrected}</span>
                  {p.gaps > 0 && (<><span>Gaps (not in document)</span><span className="text-right tabular-nums">{p.gaps}</span></>)}
                  <span className="opacity-70">Total fields</span><span className="text-right tabular-nums opacity-70">{p.total}</span>
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>
      {/* one reserved line for status text, so the stages never change height */}
      <div className="mt-2 flex h-6 items-center gap-2 text-[11px]">
        {statusNode ? (
          statusNode
        ) : extract === "failed" || upload === "failed" ? (
          <>
            <span className="min-w-0 flex-1 truncate text-gap" title={error ?? undefined}>{error ?? "Failed"}</span>
            {onRetry && (
              <Button size="xs" variant="outline" onClick={onRetry} disabled={retrying}>
                <RotateCw className={retrying ? "animate-spin" : ""} /> Retry
              </Button>
            )}
          </>
        ) : (
          <span className="truncate text-muted-foreground">
            {upload === "active"
              ? "Storing the PDF…"
              : extract === "active"
                ? "Parsing the PDF and asking the model for each field…"
                : p && review?.changed
                  ? `${review.changed} changed since v${review.previousVersion}. Unchanged reviews carried over`
                  : p
                    ? "Hover a field to inspect · click to review"
                    : ""}
          </span>
        )}
      </div>
    </div>
  );
}
