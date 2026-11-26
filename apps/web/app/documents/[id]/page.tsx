"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/app-shell";
import { DocumentStatusChip } from "@/components/app/status";
import { useUpload, useVersionDropTarget } from "@/components/app/upload-provider";
import { FieldList } from "@/components/doc/field-list";
import { PipelineStages, type StageState } from "@/components/doc/pipeline-stages";
import { ReviewCard } from "@/components/doc/review-card";
import { PdfDocument } from "@/components/doc/pdf-document";
import { SourceDocument } from "@/components/doc/source-document";
import { VersionMenu } from "@/components/doc/version-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReview } from "@/hooks/use-review";
import { API_URL, api, isInFlight } from "@/lib/api";
import { displayProgress, displayStatus, typeLabel } from "@/lib/format";
import type { DocumentDetail, ReviewInput, Value } from "@/lib/types";

/** Needs-attention first: changed values, other pending, gaps; then everything reviewed. */
const rank = (v: Value) => (v.status === "pending" ? (v.needsReReview ? 0 : v.isGap ? 2 : 1) : 3);

export default function DocumentRoute() {
  const { id } = useParams<{ id: string }>();
  return id.startsWith("pending-") ? <PendingUploadPage id={id} /> : <DocumentPage id={id} />;
}

/** Shell shared by the live document and the "still uploading" placeholder: canvas left, review sidebar right. */
function Layout({
  title,
  type,
  headerRight,
  stages,
  canvas,
  sidebar,
}: {
  title: string;
  type?: string;
  headerRight?: ReactNode;
  stages: ReactNode;
  canvas: ReactNode;
  sidebar?: ReactNode;
}) {
  return (
    <div className="flex h-svh flex-col">
      <PageHeader>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">Documents</Link>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{title}</span>
        </nav>
        {type && <span className="hidden text-xs text-muted-foreground sm:inline">{typeLabel(type)}</span>}
        <div className="flex-1" />
        {headerRight}
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-0 flex-1">{canvas}</div>
        <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t bg-background lg:max-h-none lg:w-[360px] lg:border-t-0 lg:border-l" aria-label="Review">
          {stages}
          <div className="min-h-0 flex-1 overflow-y-auto">{sidebar}</div>
        </aside>
      </div>
    </div>
  );
}

function PaperPlaceholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="h-full overflow-y-auto bg-card/60 px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-[760px] flex-col items-center gap-3 border bg-paper px-6 py-24 text-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <p className="font-serif text-xl">{title}</p>
        <div className="max-w-sm text-sm text-muted-foreground">{children}</div>
      </div>
    </section>
  );
}

function PendingUploadPage({ id }: { id: string }) {
  const { pending, retryPending } = useUpload();
  const p = pending[id];
  if (!p) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="font-serif text-xl">This upload was interrupted</p>
        <p className="text-sm text-muted-foreground">The page was reloaded before the PDF finished uploading.</p>
        <Button asChild variant="outline" size="sm"><Link href="/">Back to documents</Link></Button>
      </div>
    );
  }
  return (
    <Layout
      title={p.title}
      type={p.type}
      stages={
        <PipelineStages
          upload={p.status === "failed" ? "failed" : "active"}
          extract="waiting"
          review={null}
          version={1}
          error={p.error}
          onRetry={() => retryPending(id)}
        />
      }
      canvas={<PaperPlaceholder title={`Uploading ${p.file.name}…`}>Extraction starts as soon as the PDF is stored.</PaperPlaceholder>}
      sidebar={<SidebarSkeleton />}
    />
  );
}

function DocumentPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const { uploadNewVersion, versionUploads } = useUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null); // null = current
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cardHovered, setCardHovered] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const lastShown = useRef<string | null>(null);
  const [view, setView] = useState<"pdf" | "text">(() => {
    try {
      return (localStorage.getItem("doc-view") as "pdf" | "text" | null) ?? "pdf";
    } catch {
      return "pdf";
    }
  });
  const chooseView = (v: "pdf" | "text") => {
    setView(v);
    try {
      localStorage.setItem("doc-view", v);
    } catch {
      /* per-browser convenience only */
    }
  };

  const doc = useQuery({
    queryKey: ["document", id, viewVersion],
    queryFn: () => api.getDocument(id, viewVersion ?? undefined),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (isInFlight(q.state.data?.status) ? 2000 : false),
  });
  const d = doc.data;
  const versionUpload = versionUploads[id];

  // While the current version is extracting, keep the latest extracted one on the canvas (read-only).
  const fallbackVersion =
    d && viewVersion == null && d.version.isCurrent && d.version.status !== "extracted"
      ? [...d.versions].reverse().find((x) => x.status === "extracted")?.version
      : undefined;
  const fallback = useQuery({
    queryKey: ["document", id, fallbackVersion ?? -1],
    queryFn: () => api.getDocument(id, fallbackVersion),
    enabled: fallbackVersion != null,
  });
  const shown: DocumentDetail | undefined = fallbackVersion != null ? fallback.data : d;

  const review = useReview(id, viewVersion);
  const retry = useMutation({
    mutationFn: () => api.retry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const nextVersion = (d?.versions.length ?? 0) + 1;
  useVersionDropTarget(d ? { documentId: id, title: d.title, nextVersion } : null);

  const values = useMemo(() => (shown ? [...shown.values].sort((a, b) => rank(a) - rank(b)) : []), [shown]);
  const readOnly = !shown || !shown.version.isCurrent || shown.version.status !== "extracted";

  // What the floating card shows: a hover preview, else the pinned field. While correcting it stays
  // on the pinned field; while the pointer is inside the card it freezes, so its buttons are reachable.
  const shownId = correcting ? pinnedId : cardHovered ? lastShown.current : (hoverId ?? pinnedId);
  lastShown.current = shownId;
  const cardValue = values.find((v) => v.id === shownId) ?? null;
  const highlightId = hoverId ?? pinnedId;
  const busy = review.isPending && review.variables?.valueId === cardValue?.id;

  const pin = useCallback((vid: string | null) => {
    setPinnedId(vid);
    setCorrecting(false);
    setCardHovered(false);
  }, []);

  // If the card unmounts under the pointer (e.g. a new version replaced its field), no pointerleave
  // fires; without this the card would stay "frozen" on a field that no longer exists.
  useEffect(() => {
    if (cardHovered && !cardValue) setCardHovered(false);
  }, [cardHovered, cardValue]);

  const act = useCallback(
    (v: Value, input: ReviewInput) => {
      setPinnedId(v.id);
      review.mutate({ valueId: v.id, input, expectedLatestEventId: v.latestEventId });
    },
    [review],
  );
  // Undo/redo are server-side review actions; the stacks are replayed from the stored history.
  const undo = useCallback((v: Value) => v.canUndo && act(v, { action: "undo" }), [act]);
  const redoLast = useCallback((v: Value) => v.canRedo && act(v, { action: "redo" }), [act]);

  // Keyboard: J/K or arrows step through fields, A approves, C corrects, U / Shift+U undo/redo, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape" && !t.closest("[role=dialog], [role=menu]")) {
        pin(null);
        return;
      }
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!values.length) return;
      const idx = values.findIndex((v) => v.id === pinnedId);
      const k = e.key.toLowerCase();
      const current = values.find((v) => v.id === pinnedId);
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        pin(values[idx < 0 ? 0 : Math.min(values.length - 1, idx + 1)]!.id);
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        pin(values[idx < 0 ? 0 : Math.max(0, idx - 1)]!.id);
      } else if (!readOnly && current) {
        if (k === "a" && displayStatus(current) !== "approved") act(current, { action: "approve" });
        else if (k === "c") {
          e.preventDefault();
          setCorrecting(true);
        } else if (k === "u") (e.shiftKey ? redoLast : undo)(current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [values, pinnedId, readOnly, act, undo, redoLast, pin]);

  if (doc.isLoading) {
    return <Layout title="" stages={<PipelineStages upload="done" extract="waiting" review={null} version={null} />} canvas={<CanvasSkeleton />} sidebar={<SidebarSkeleton />} />;
  }
  if (doc.error || !d) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="font-serif text-xl">Couldn&apos;t load this document</p>
        <p className="text-sm text-muted-foreground">{doc.error?.message}</p>
        <Button asChild variant="outline" size="sm"><Link href="/">Back to documents</Link></Button>
      </div>
    );
  }

  const v = d.version;
  // stages describe the version being processed: an in-flight new upload, else the version being viewed
  const upload: StageState = versionUpload ? (versionUpload.status === "failed" ? "failed" : "active") : "done";
  const extract: StageState = versionUpload
    ? "waiting"
    : v.status === "extracted"
      ? "done"
      : v.status === "failed"
        ? "failed"
        : v.status === "superseded"
          ? "waiting"
          : "active";
  const showReview = !versionUpload && v.status === "extracted" && shown;
  const changed = shown?.values.filter((x) => x.status === "pending" && x.needsReReview).length ?? 0;

  const statusNode =
    !versionUpload && !v.isCurrent ? (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="truncate">
          Viewing v{v.version}{v.status === "superseded" ? " (superseded before extraction finished)" : ""}, read-only
        </span>
        <button type="button" className="shrink-0 text-foreground underline underline-offset-2" onClick={() => setViewVersion(null)}>
          Back to v{d.currentVersion}
        </button>
      </span>
    ) : !versionUpload && fallbackVersion != null && extract === "active" ? (
      <span className="truncate text-muted-foreground">Extracting v{v.version}. Showing v{fallbackVersion} until it&apos;s ready</span>
    ) : undefined;

  const canvas = shown?.version.parsedText ? (
    <>
      <section
        className="h-full overflow-y-auto bg-card/60 px-4 pt-8 pb-[45vh] sm:px-8"
        aria-label="Source document"
        onPointerDown={(e) => {
          // clicking empty space (not a field, not the card) dismisses the review card
          if (!(e.target as HTMLElement).closest(".evidence, .evidence-box, [data-review-card], [data-view-toggle]")) pin(null);
        }}
      >
        {view === "pdf" ? (
          <PdfDocument
            url={`${API_URL}/documents/${encodeURIComponent(id)}/versions/${shown.version.version}/file`}
            values={shown.values}
            focusedId={highlightId}
            onHover={setHoverId}
            onSelect={pin}
          />
        ) : (
          <SourceDocument text={shown.version.parsedText} values={shown.values} focusedId={highlightId} onHover={setHoverId} onSelect={pin} />
        )}
      </section>

      <div data-view-toggle className="absolute top-3 right-4 z-10 flex border bg-background/95 p-0.5 text-xs shadow-sm backdrop-blur" role="tablist" aria-label="Document view">
        {(["pdf", "text"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => chooseView(k)}
            className={view === k ? "bg-foreground px-2.5 py-1 text-background" : "px-2.5 py-1 text-muted-foreground hover:text-foreground"}
          >
            {k === "pdf" ? "PDF" : "Text"}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
        {cardValue ? (
          <div
            data-review-card
            className="pointer-events-auto max-h-[42vh] w-full max-w-[680px] overflow-y-auto border bg-card/95 p-4 shadow-[0_24px_48px_-20px_rgb(0_0_0/0.35)] backdrop-blur animate-in fade-in-0 slide-in-from-bottom-1"
            onPointerEnter={() => setCardHovered(true)}
            onPointerLeave={() => setCardHovered(false)}
            onPointerDown={() => pinnedId !== cardValue.id && pin(cardValue.id)}
          >
            <ReviewCard
              key={cardValue.id}
              value={cardValue}
              pinned={pinnedId === cardValue.id}
              readOnly={readOnly}
              busy={busy}
              correcting={correcting && pinnedId === cardValue.id}
              setCorrecting={(b) => {
                setPinnedId(cardValue.id);
                setCorrecting(b);
              }}
              onReview={(input) => act(cardValue, input)}
              onUndo={() => undo(cardValue)}
              onRedo={() => redoLast(cardValue)}
              onClose={() => pin(null)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <MousePointerClick className="size-3.5" /> Hover a field to inspect it · click to review · <kbd>J</kbd>/<kbd>K</kbd> to step through
          </div>
        )}
      </div>
    </>
  ) : (
    <PaperPlaceholder title={versionUpload ? `Uploading v${versionUpload.version}…` : `Reading v${v.version}…`}>
      Parsing the PDF and asking the model for each field. This page updates on its own.
    </PaperPlaceholder>
  );

  return (
    <Layout
      title={d.title}
      type={d.type}
      headerRight={
        <>
          <DocumentStatusChip status={d.status} pending={d.progress.pending} className="hidden sm:inline-flex" />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setViewVersion(null);
                uploadNewVersion({ documentId: id, title: d.title, nextVersion }, f);
              }
              e.target.value = "";
            }}
          />
          <VersionMenu
            versions={d.versions}
            current={d.currentVersion}
            viewing={viewVersion ?? d.currentVersion}
            onView={(x) => {
              pin(null);
              setViewVersion(x === d.currentVersion ? null : x);
            }}
            onUploadNew={() => fileRef.current?.click()}
          />
        </>
      }
      stages={
        <PipelineStages
          upload={upload}
          extract={extract}
          version={versionUpload ? versionUpload.version : v.version}
          review={
            showReview
              ? {
                  progress: displayProgress(shown.values),
                  changed,
                  previousVersion: shown.version.version > 1 ? shown.version.version - 1 : null,
                  readOnlyNote: readOnly ? "read-only" : undefined,
                }
              : null
          }
          error={versionUpload?.error ?? v.error}
          onRetry={v.status === "failed" && v.isCurrent ? () => retry.mutate() : undefined}
          retrying={retry.isPending}
          statusNode={statusNode}
        />
      }
      canvas={canvas}
      sidebar={
        values.length ? (
          <>
            <p className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Fields</p>
            <FieldList values={values} focusedId={highlightId} selectedId={pinnedId} onHover={setHoverId} onSelect={pin} />
          </>
        ) : (
          <SidebarSkeleton />
        )
      }
    />
  );
}

function CanvasSkeleton() {
  return (
    <div className="h-full bg-card/60 p-8">
      <div className="mx-auto max-w-[760px] space-y-3 border bg-paper p-12">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
        ))}
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  );
}
