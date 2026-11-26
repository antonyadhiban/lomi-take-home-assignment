"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, FileStack, Loader2, RotateCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/app/app-shell";
import { ProgressBar } from "@/components/app/progress";
import { VersionStatusChip } from "@/components/app/status";
import { useUpload, useVersionDropTarget } from "@/components/app/upload-provider";
import { FieldDetail } from "@/components/doc/field-detail";
import { FieldList } from "@/components/doc/field-list";
import { SourceDocument } from "@/components/doc/source-document";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { isOptimistic, useReview } from "@/hooks/use-review";
import { api, isInFlight } from "@/lib/api";
import { displayProgress, displayStatus, typeLabel } from "@/lib/format";
import type { DocumentDetail, ReviewInput, Value } from "@/lib/types";

/** Needs-attention first: changed values, other pending, gaps; then everything reviewed. */
const rank = (v: Value) => (v.status === "pending" ? (v.needsReReview ? 0 : v.isGap ? 2 : 1) : 3);

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { uploadNewVersion } = useUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null); // null = current
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const redo = useRef(new Map<string, string[]>()); // valueId -> undone event ids
  const [, bump] = useState(0);

  const doc = useQuery({
    queryKey: ["document", id, viewVersion],
    queryFn: () => api.getDocument(id, viewVersion ?? undefined),
    placeholderData: (prev) => prev, // keep showing the last version while switching
    refetchInterval: (q) => (isInFlight(q.state.data?.status) ? 2000 : false),
  });
  const d = doc.data;

  // While the current version is still extracting, show the latest extracted one underneath.
  const fallbackVersion =
    d && viewVersion == null && d.version.isCurrent && d.version.status !== "extracted"
      ? [...d.versions].reverse().find((x) => x.status === "extracted")?.version
      : undefined;
  const fallback = useQuery({
    queryKey: ["document", id, fallbackVersion ?? -1],
    queryFn: () => api.getDocument(id, fallbackVersion),
    enabled: fallbackVersion != null,
  });
  const shown = fallbackVersion != null ? fallback.data : d;

  const review = useReview(id, fallbackVersion != null ? fallbackVersion : viewVersion);
  const retry = useMutation({
    mutationFn: () => api.retry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  useVersionDropTarget(d ? { documentId: id, title: d.title, nextVersion: d.versions.length + 1 } : null);

  const values = useMemo(() => (shown ? [...shown.values].sort((a, b) => rank(a) - rank(b)) : []), [shown]);
  const readOnly = !shown || !shown.version.isCurrent || shown.version.status !== "extracted";

  // default selection: the first thing that needs attention
  useEffect(() => {
    if (!values.length) return;
    if (!selectedId || !values.some((v) => v.id === selectedId)) setSelectedId(values[0]!.id);
  }, [values, selectedId]);

  const focusedId = hoverId ?? selectedId;
  const selected = values.find((v) => v.id === selectedId) ?? null;
  const busy = review.isPending && review.variables?.valueId === selected?.id;

  const act = useCallback(
    (v: Value, input: ReviewInput, keepRedo = false) => {
      if (!keepRedo) redo.current.delete(v.id);
      review.mutate({ valueId: v.id, input, expectedLatestEventId: v.latestEventId });
    },
    [review],
  );

  // Undo = re-apply the state before the latest event; redo = re-apply what was undone. Both append events.
  const undo = useCallback(
    (v: Value) => {
      const latest = v.history.at(-1);
      if (!latest || isOptimistic(latest.id)) return;
      const before = v.history.at(-2);
      act(v, before ? { action: "restore", eventId: before.id } : { action: "reset" }, true);
      redo.current.set(v.id, [...(redo.current.get(v.id) ?? []), latest.id]);
      bump((n) => n + 1);
    },
    [act],
  );
  const redoLast = useCallback(
    (v: Value) => {
      const stack = redo.current.get(v.id) ?? [];
      const eventId = stack.at(-1);
      if (!eventId) return;
      act(v, { action: "restore", eventId }, true);
      redo.current.set(v.id, stack.slice(0, -1));
      bump((n) => n + 1);
    },
    [act],
  );

  // Keyboard: J/K or arrows move between fields, A approves, C corrects, U undoes, Shift+U redoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog], [role=listbox]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!values.length) return;
      const idx = Math.max(0, values.findIndex((v) => v.id === selectedId));
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setHoverId(null);
        setSelectedId(values[Math.min(values.length - 1, idx + 1)]!.id);
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setHoverId(null);
        setSelectedId(values[Math.max(0, idx - 1)]!.id);
      } else if (!readOnly && selected) {
        if (k === "a" && displayStatus(selected) !== "approved") act(selected, { action: "approve" });
        else if (k === "c") {
          e.preventDefault();
          setHoverId(null);
          setCorrecting(true);
        } else if (k === "u") (e.shiftKey ? redoLast : undo)(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [values, selectedId, selected, readOnly, act, undo, redoLast]);

  if (doc.isLoading) return <DocumentSkeleton />;
  if (doc.error || !d) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="font-serif text-xl">Couldn&apos;t load this document</p>
        <p className="text-sm text-muted-foreground">{doc.error?.message}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to documents</Link>
        </Button>
      </div>
    );
  }

  const v = d.version;
  const pending = shown?.values.filter((x) => x.status === "pending") ?? [];
  const changed = pending.filter((x) => x.needsReReview).length;

  return (
    <div className="flex h-svh flex-col">
      <PageHeader>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            Documents
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{d.title}</span>
        </nav>
        <span className="hidden text-xs text-muted-foreground sm:inline">{typeLabel(d.type)}</span>
        <div className="flex-1" />
        <VersionStatusChip status={d.status} className="hidden sm:inline-flex" />
        <Select value={String(viewVersion ?? d.currentVersion)} onValueChange={(x) => setViewVersion(Number(x) === d.currentVersion ? null : Number(x))}>
          <SelectTrigger size="sm" className="w-auto gap-2 font-mono text-xs" aria-label="Version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {[...d.versions].reverse().map((x) => (
              <SelectItem key={x.version} value={String(x.version)} className="font-mono text-xs">
                v{x.version}
                {x.version === d.currentVersion ? " · current" : ""}
                {x.status !== "extracted" ? ` · ${x.status}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setViewVersion(null);
              uploadNewVersion({ documentId: id, title: d.title, nextVersion: d.versions.length + 1 }, f);
            }
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileStack /> <span className="hidden sm:inline">New version</span>
        </Button>
      </PageHeader>

      <Banners
        d={d}
        viewingFallback={fallbackVersion}
        onCurrent={() => setViewVersion(null)}
        onRetry={() => retry.mutate()}
        retrying={retry.isPending}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 flex-1 overflow-y-auto bg-card/60 px-4 py-8 sm:px-8" aria-label="Source document">
          {shown?.version.parsedText ? (
            <SourceDocument
              text={shown.version.parsedText}
              values={shown.values}
              focusedId={focusedId}
              onHover={setHoverId}
              onSelect={(vid) => {
                setSelectedId(vid);
                setCorrecting(false);
              }}
            />
          ) : isInFlight(v.status) ? (
            <div className="mx-auto flex max-w-[760px] flex-col items-center gap-3 border bg-paper px-6 py-24 text-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="font-serif text-xl">Reading v{v.version}…</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Parsing the PDF and asking the model for each field. This page updates on its own.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-[760px] border bg-paper px-6 py-24 text-center text-sm text-muted-foreground">
              No text stored for this version.
            </div>
          )}
          <p className="mx-auto mt-3 max-w-[760px] text-xs text-muted-foreground">
            Hover a passage or field to highlight it · click to review it below · <kbd>J</kbd>/<kbd>K</kbd> to move · drop a PDF to upload v
            {d.versions.length + 1}
          </p>
        </section>

        <aside className="flex max-h-[55vh] w-full shrink-0 flex-col border-t bg-background lg:max-h-none lg:w-[400px] lg:border-t-0 lg:border-l" aria-label="Review">
          {shown && shown.version.status === "extracted" ? (
            <>
              <div className="border-b px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {readOnly ? `v${shown.version.version} · read-only history` : "Review progress"}
                </p>
                <ProgressBar progress={displayProgress(shown.values)} className="mt-2" />
              </div>

              {/* Stable zone: the list never moves when you hover; hover only highlights here and in the document. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2.5">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Fields</span>
                  {readOnly ? null : pending.length ? (
                    <>
                      <span className="inline-flex h-5 min-w-5 items-center justify-center bg-foreground px-1.5 text-[11px] font-medium tabular-nums text-background">
                        {pending.length}
                      </span>
                      <span className="text-xs">to review</span>
                    </>
                  ) : (
                    <span className="text-xs text-approved">All reviewed</span>
                  )}
                  <span className="flex-1" />
                  {!readOnly && changed > 0 && (
                    <span className="text-[11px] text-pending">{changed} changed since v{shown.version.version - 1}</span>
                  )}
                  <span className="text-[11px] tabular-nums text-muted-foreground">{shown.values.length} total</span>
                </div>
                <FieldList
                  values={values}
                  focusedId={focusedId}
                  selectedId={selectedId}
                  onHover={setHoverId}
                  onSelect={(vid) => {
                    setSelectedId(vid);
                    setCorrecting(false);
                  }}
                />
              </div>

              {/* Docked review panel: follows the selected field only (click, J/K), never hover. */}
              {selected && (
                <div
                  className="max-h-[62%] shrink-0 overflow-y-auto border-t bg-card px-4 pt-4 pb-5 shadow-[0_-12px_24px_-16px_rgb(0_0_0/0.25)]"
                  aria-label={`Review ${selected.field}`}
                >
                  <FieldDetail
                    key={selected.id}
                    value={selected}
                    readOnly={readOnly}
                    busy={busy}
                    redoCount={redo.current.get(selected.id)?.length ?? 0}
                    onReview={(input) => act(selected, input)}
                    onUndo={() => undo(selected)}
                    onRedo={() => redoLast(selected)}
                    correcting={correcting}
                    setCorrecting={(b) => {
                      setHoverId(null);
                      setCorrecting(b);
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-1 w-full" />
              <Skeleton className="mt-6 h-8 w-2/3" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Banners({
  d,
  viewingFallback,
  onCurrent,
  onRetry,
  retrying,
}: {
  d: DocumentDetail;
  viewingFallback?: number;
  onCurrent: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const v = d.version;
  const base = "flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm md:px-6";
  if (!v.isCurrent)
    return (
      <div className={`${base} bg-accent`}>
        <span>
          Viewing <span className="font-mono">v{v.version}</span> ({v.status}). Read-only history: its own text, values and reviews.
        </span>
        <Button size="sm" variant="outline" onClick={onCurrent}>
          Back to v{d.currentVersion}
        </Button>
      </div>
    );
  if (isInFlight(v.status))
    return (
      <div className={`${base} bg-accent`}>
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span>
          Extracting <span className="font-mono">v{v.version}</span>…
          {viewingFallback != null && (
            <span className="text-muted-foreground"> Showing v{viewingFallback} until it&apos;s ready.</span>
          )}
        </span>
      </div>
    );
  if (v.status === "failed")
    return (
      <div className={`${base} bg-gap/8 text-gap`}>
        <AlertTriangle className="size-4" />
        <span className="min-w-0 flex-1">
          Extraction of <span className="font-mono">v{v.version}</span> failed{v.lastRun ? ` (attempt ${v.lastRun.attempt})` : ""}: {v.error}
        </span>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RotateCw className={retrying ? "animate-spin" : ""} /> Retry
        </Button>
      </div>
    );
  return null;
}

function DocumentSkeleton() {
  return (
    <div className="flex h-svh flex-col">
      <div className="flex h-14 items-center gap-3 border-b px-6">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex flex-1">
        <div className="flex-1 bg-card/60 p-8">
          <div className="mx-auto max-w-[760px] space-y-3 border bg-paper p-12">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
            ))}
          </div>
        </div>
        <div className="hidden w-[400px] space-y-3 border-l p-4 lg:block">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-1 w-full" />
          <Skeleton className="mt-6 h-8 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}
