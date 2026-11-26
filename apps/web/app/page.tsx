"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/app-shell";
import { PipelineChart } from "@/components/app/pipeline-chart";
import { ProgressBar } from "@/components/app/progress";
import { DocumentStatusChip } from "@/components/app/status";
import { useUpload } from "@/components/app/upload-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isInFlight } from "@/lib/api";
import { timeAgo, typeLabel } from "@/lib/format";

export default function DocumentsPage() {
  const qc = useQueryClient();
  const { openNewDocument } = useUpload();
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    try { setExpanded(localStorage.getItem("review-pipeline") !== "collapsed"); } catch { /* storage is optional */ }
  }, []);
  const togglePipeline = () => {
    setExpanded(!expanded);
    try { localStorage.setItem("review-pipeline", expanded ? "collapsed" : "expanded"); } catch { /* storage is optional */ }
  };
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: api.listDocuments,
    // poll only while something is queued/extracting; otherwise refresh on focus
    refetchInterval: (q) => (q.state.data?.some((d) => isInFlight(d.status)) ? 2000 : false),
  });

  // Prefetch on hover: by the time the click lands, the detail is usually already cached.
  const prefetch = (id: string) =>
    qc.prefetchQuery({ queryKey: ["document", id, null], queryFn: () => api.getDocument(id), staleTime: 10_000 });

  const totalPending = docs.data?.reduce((n, d) => n + d.progress.pending, 0) ?? 0;
  const inFlight = docs.data?.filter((d) => isInFlight(d.status)).length ?? 0;
  const failed = docs.data?.filter((d) => d.status === "failed").length ?? 0;

  return (
    <>
      <PageHeader>
        <h1 className="text-sm font-medium">Documents</h1>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <section className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <div className={expanded ? "col-span-2 flex items-center justify-between gap-2 border px-3 py-2" : "flex items-center gap-3"}>
            <h2>
              <button type="button" aria-expanded={expanded} aria-controls="pipeline-chart" onClick={togglePipeline} className="flex items-center gap-2 py-1 font-serif text-lg">
                <ChevronDown aria-hidden className={expanded ? "size-4" : "size-4 -rotate-90"} /> Review pipeline
              </button>
            </h2>
            <div className="hidden text-xs text-muted-foreground sm:block">
              {docs.data ? (
                <>
                  <span className="text-foreground tabular-nums">{totalPending}</span> value{totalPending === 1 ? "" : "s"} waiting for review
                </>
              ) : (
                <Skeleton className="inline-block h-3 w-32" />
              )}
            </div>
          </div>
          <div id="pipeline-chart" hidden={!expanded} className="col-span-2 border border-t-0">
            {expanded && (docs.data ? (
              <PipelineChart
                stages={[
                  { label: "Uploaded", value: docs.data.length },
                  {
                    label: "Extracted",
                    value: docs.data.filter((d) => d.latestExtractedVersion != null).length,
                    detail: [inFlight && `${inFlight} extracting`, failed && `${failed} failed`].filter(Boolean).join(", ") || undefined,
                  },
                  {
                    label: "Fully reviewed",
                    value: docs.data.filter((d) => d.status === "extracted" && d.progress.total > 0 && d.progress.pending === 0).length,
                    detail: `${totalPending} values to go`,
                  },
                ]}
              />
            ) : (
              <Skeleton className="mx-4 mb-4 h-48" />
            ))}
          </div>
          <Button size="sm" className={expanded ? "col-span-2 mt-3 justify-self-end" : "justify-self-end"} onClick={() => openNewDocument()}>
            <Upload /> Upload PDF
          </Button>
        </section>

        <div className="border">
          <div className="hidden grid-cols-[minmax(0,2.4fr)_1fr_0.6fr_1fr_1.6fr_24px] gap-4 border-b px-4 py-2.5 text-xs text-muted-foreground md:grid">
            <span>Document</span>
            <span>Type</span>
            <span>Version</span>
            <span>Status</span>
            <span>Review</span>
            <span />
          </div>

          {docs.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-0">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="ml-auto h-1 w-40" />
              </div>
            ))}

          {docs.error && (
            <div className="px-4 py-12 text-center text-sm text-gap">Couldn&apos;t reach the API: {docs.error.message}</div>
          )}

          {docs.data?.length === 0 && (
            <button
              type="button"
              onClick={() => openNewDocument()}
              className="flex w-full flex-col items-center gap-2 px-4 py-16 text-center text-muted-foreground hover:bg-accent"
            >
              <Upload className="size-5" />
              <span className="font-serif text-lg text-foreground">No documents yet</span>
              <span className="text-xs">Drop a PDF anywhere, or click to upload.</span>
            </button>
          )}

          {docs.data?.map((d) => (
            <Link
              key={d.id}
              href={`/documents/${d.id}`}
              onMouseEnter={() => prefetch(d.id)}
              onFocus={() => prefetch(d.id)}
              className="group grid grid-cols-1 gap-2 border-b px-4 py-4 transition-colors last:border-0 hover:bg-accent md:grid-cols-[minmax(0,2.4fr)_1fr_0.6fr_1fr_1.6fr_24px] md:items-center md:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">Added {timeAgo(d.createdAt)}</p>
              </div>
              <span className="text-muted-foreground">{typeLabel(d.type)}</span>
              <span className="text-muted-foreground tabular-nums">{d.currentVersion}</span>
              <span>
                <DocumentStatusChip status={d.status} pending={d.progress.pending} />
              </span>
              <div className="min-w-0">
                {d.status === "extracted" ? (
                  <>
                    <ProgressBar progress={d.progress} />
                    <p className="mt-1.5 text-xs">
                      {d.progress.pending ? (
                        <span className="text-foreground">{d.progress.pending} to review</span>
                      ) : (
                        <span className="text-muted-foreground">All {d.progress.total} reviewed</span>
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        · {d.progress.total - d.progress.pending}/{d.progress.total}
                        {d.progress.gaps > 0 && ` · ${d.progress.gaps} gap${d.progress.gaps > 1 ? "s" : ""}`}
                      </span>
                    </p>
                  </>
                ) : d.status === "failed" ? (
                  <p className="truncate text-xs text-gap" title={d.error ?? undefined}>{d.error}</p>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <ArrowUpRight className="hidden size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:block" />
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Tip: drop a PDF anywhere on this page to start a new document.</p>
      </div>
    </>
  );
}
