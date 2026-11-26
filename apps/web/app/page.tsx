"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Upload } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/app-shell";
import { ProgressBar } from "@/components/app/progress";
import { VersionStatusChip } from "@/components/app/status";
import { useUpload } from "@/components/app/upload-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isInFlight } from "@/lib/api";
import { timeAgo, typeLabel } from "@/lib/format";

export default function DocumentsPage() {
  const qc = useQueryClient();
  const { openNewDocument } = useUpload();
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

  return (
    <>
      <PageHeader>
        <h1 className="text-sm font-medium">Documents</h1>
        <div className="flex-1" />
        <Button size="sm" onClick={() => openNewDocument()}>
          <Upload /> Upload PDF
        </Button>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-8 grid gap-px border bg-border sm:grid-cols-3">
          <Stat label="Waiting for review" value={docs.data ? totalPending : undefined} emphasis={totalPending > 0} />
          <Stat label="Documents" value={docs.data?.length} />
          <Stat label="Extracting now" value={docs.data ? inFlight : undefined} />
        </div>

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
              <span className="font-mono text-xs text-muted-foreground">v{d.currentVersion}</span>
              <span>
                <VersionStatusChip status={d.status} />
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

  function Stat({ label, value, emphasis }: { label: string; value?: number; emphasis?: boolean }) {
    return (
      <div className="bg-background px-5 py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {value === undefined ? (
          <Skeleton className="mt-2 h-8 w-12" />
        ) : (
          <p className={`mt-1 font-serif text-3xl ${emphasis ? "text-foreground" : "text-muted-foreground"}`}>{value}</p>
        )}
      </div>
    );
  }
}
