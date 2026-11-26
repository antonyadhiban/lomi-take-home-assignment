"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProgressBar } from "@/components/ProgressBar";
import { VersionBadge } from "@/components/StatusBadge";
import { UploadForm } from "@/components/UploadForm";
import { api, isInFlight } from "@/lib/api";
import { timeAgo, typeLabel } from "@/lib/format";

export default function DocumentList() {
  const router = useRouter();
  // Poll only while something is queued/extracting; otherwise refresh on focus.
  const docs = useQuery({
    queryKey: ["documents"],
    queryFn: api.listDocuments,
    refetchInterval: (q) => (q.state.data?.some((d) => isInFlight(d.status)) ? 2000 : false),
  });

  const needing = docs.data?.reduce((n, d) => n + d.progress.pending, 0) ?? 0;

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Documents</h1>
          {docs.data && (
            <span className={needing ? "attention" : "done"}>
              {needing ? `${needing} value${needing === 1 ? "" : "s"} waiting for review` : "Everything is reviewed"}
            </span>
          )}
        </div>
      </header>

      <UploadForm />
      <div style={{ height: 16 }} />

      <div className="card">
        {docs.isLoading && <div className="empty">Loading…</div>}
        {docs.error && <div className="empty error-text">Couldn&apos;t reach the API: {docs.error.message}</div>}
        {docs.data?.length === 0 && <div className="empty">No documents yet. Upload a PDF above.</div>}
        {!!docs.data?.length && (
          <table className="doc-table">
            <thead>
              <tr>
                <th>Document</th>
                <th className="hide-sm">Type</th>
                <th>Version</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id} onClick={() => router.push(`/documents/${d.id}`)}>
                  <td>
                    <Link className="doc-title" href={`/documents/${d.id}`} onClick={(e) => e.stopPropagation()}>
                      {d.title}
                    </Link>
                    <div className="muted small">{timeAgo(d.createdAt)}</div>
                  </td>
                  <td className="hide-sm muted">{typeLabel(d.type)}</td>
                  <td className="mono">v{d.currentVersion}</td>
                  <td>
                    <VersionBadge status={d.status} />
                    {d.status === "failed" && d.error && <div className="error-text small">{d.error}</div>}
                  </td>
                  <td style={{ minWidth: 200 }}>
                    {d.status === "extracted" ? (
                      <>
                        <ProgressBar progress={d.progress} />
                        <div className="small" style={{ marginTop: 4 }}>
                          {d.progress.pending ? (
                            <span className="attention">{d.progress.pending} to review</span>
                          ) : (
                            <span className="done">All {d.progress.total} reviewed</span>
                          )}
                          {d.progress.gaps > 0 && <span className="muted"> · {d.progress.gaps} gap{d.progress.gaps > 1 ? "s" : ""}</span>}
                        </div>
                      </>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
