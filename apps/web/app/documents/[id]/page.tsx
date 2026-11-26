"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { DocumentText } from "@/components/DocumentText";
import { ProgressBar } from "@/components/ProgressBar";
import { VersionBadge } from "@/components/StatusBadge";
import { ValueCard } from "@/components/ValueCard";
import { api, isInFlight } from "@/lib/api";
import { typeLabel } from "@/lib/format";
import type { ReviewInput, Value } from "@/lib/types";

/** Needs-attention first: changed values, then other pending values, then gaps; reviewed values after. */
function rank(v: Value) {
  if (v.status === "pending") return v.needsReReview ? 0 : v.isGap ? 2 : 1;
  return 3;
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [viewVersion, setViewVersion] = useState<number | null>(null); // null = current
  const [selected, setSelected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doc = useQuery({
    queryKey: ["document", id, viewVersion],
    queryFn: () => api.getDocument(id, viewVersion ?? undefined),
    // poll only while the current version is being extracted
    refetchInterval: (q) => (isInFlight(q.state.data?.status) ? 2000 : false),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["document", id] });
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  const review = (valueId: string) => async (input: ReviewInput & { expectedLatestEventId?: string | null }) => {
    try {
      return await api.review(valueId, input);
    } finally {
      refresh();
    }
  };

  const newVersion = useMutation({
    mutationFn: (file: File) => api.uploadVersion(id, file),
    onSuccess: () => {
      setViewVersion(null);
      refresh();
    },
  });
  const retry = useMutation({ mutationFn: () => api.retry(id), onSuccess: refresh });

  const d = doc.data;
  const values = useMemo(() => (d ? [...d.values].sort((a, b) => rank(a) - rank(b)) : []), [d]);

  if (doc.isLoading) return <div className="empty">Loading…</div>;
  if (doc.error || !d) return <div className="empty error-text">{doc.error?.message ?? "Not found"}</div>;

  const v = d.version;
  const readOnly = !v.isCurrent || v.status !== "extracted";
  const pending = values.filter((x) => x.status === "pending");
  const changed = pending.filter((x) => x.needsReReview).length;
  const lastExtracted = [...d.versions].reverse().find((x) => x.status === "extracted" && x.version !== v.version);
  const needsReview = values.filter((x) => rank(x) < 3);
  const reviewed = values.filter((x) => rank(x) === 3);

  const card = (x: Value) => (
    <ValueCard
      key={x.id}
      value={x}
      selected={selected === x.id}
      readOnly={readOnly}
      onSelect={() => setSelected(x.id)}
      onReview={review(x.id)}
    />
  );

  return (
    <>
      <Link href="/" className="brand">← All documents</Link>
      <div className="detail-head" style={{ marginTop: 12 }}>
        <div>
          <h1>{d.title}</h1>
          <div className="row muted">
            <span>{typeLabel(d.type)}</span>·<span className="mono">v{d.currentVersion} current</span>
            <VersionBadge status={d.status} />
          </div>
        </div>
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) newVersion.mutate(f);
              e.target.value = "";
            }}
          />
          <button className="btn" disabled={newVersion.isPending} onClick={() => fileRef.current?.click()}>
            {newVersion.isPending ? "Uploading…" : "Upload new version"}
          </button>
        </div>
      </div>

      {newVersion.data?.duplicate && <div className="banner banner-info">That file is identical to v{newVersion.data.currentVersion}; nothing to re-extract.</div>}
      {newVersion.error && <div className="banner banner-error">{newVersion.error.message}</div>}

      {d.versions.length > 1 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted small">Versions:</span>
          <div className="versions">
            {d.versions.map((x) => (
              <button
                key={x.version}
                className="btn btn-sm"
                aria-pressed={x.version === v.version}
                onClick={() => setViewVersion(x.version === d.currentVersion ? null : x.version)}
                title={x.status}
              >
                v{x.version}
                {x.status !== "extracted" && <span className="muted"> · {x.status}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {!v.isCurrent && (
        <div className="banner banner-warn">
          You&apos;re viewing v{v.version} (read-only history).
          <button className="btn btn-sm" onClick={() => setViewVersion(null)}>Go to current v{d.currentVersion}</button>
        </div>
      )}
      {v.isCurrent && isInFlight(v.status) && (
        <div className="banner banner-info">
          <span className="badge b-extracting pulse"><span className="dot" />{v.status === "queued" ? "Queued" : "Extracting"}</span>
          v{v.version} is being extracted. This page updates on its own.
          {lastExtracted && (
            <button className="btn btn-sm" onClick={() => setViewVersion(lastExtracted.version)}>View v{lastExtracted.version} meanwhile</button>
          )}
        </div>
      )}
      {v.status === "failed" && (
        <div className="banner banner-error">
          Extraction failed{v.lastRun ? ` (attempt ${v.lastRun.attempt})` : ""}: {v.error}
          {v.isCurrent && (
            <button className="btn btn-sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
              {retry.isPending ? "Retrying…" : "Retry extraction"}
            </button>
          )}
          {retry.error && <span>{retry.error.message}</span>}
        </div>
      )}
      {v.status === "superseded" && (
        <div className="banner banner-warn">v{v.version} was replaced by a newer upload before its extraction finished.</div>
      )}

      {v.status === "extracted" && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <p className="attention-line">
            {readOnly ? (
              <span className="muted">Review state of v{v.version}</span>
            ) : pending.length ? (
              <span className="attention">
                {pending.length} value{pending.length === 1 ? "" : "s"} need{pending.length === 1 ? "s" : ""} your review
                {changed > 0 && ` · ${changed} changed since the previous version`}
              </span>
            ) : (
              <span className="done">All {d.progress.total} values reviewed ✓</span>
            )}
          </p>
          <ProgressBar progress={d.progress} legend />
        </div>
      )}

      {v.status === "extracted" && (
        <div className="split">
          <section className="values" aria-label="Extracted values">
            {/* one keyed list, so a card keeps its state (e.g. redo stack) when it moves between groups */}
            {[
              ...(needsReview.length ? [<h2 key="h-needs" className="group-title">Needs review</h2>] : []),
              ...needsReview.map(card),
              ...(reviewed.length ? [<h2 key="h-reviewed" className="group-title">Reviewed</h2>] : []),
              ...reviewed.map(card),
            ]}
          </section>
          <aside className="card source" aria-label="Document text">
            <div className="source-head">
              <strong>Source text · v{v.version}</strong>
              <span className="muted small">Highlighted passages are the evidence; click one to find its value</span>
            </div>
            {v.parsedText ? (
              <DocumentText
                text={v.parsedText}
                quotes={d.values.filter((x) => x.evidence).map((x) => ({ id: x.id, evidence: x.evidence! }))}
                activeId={selected}
                onSelect={(vid) => {
                  setSelected(vid);
                  document.getElementById(`value-${vid}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }}
              />
            ) : (
              <div className="empty">No text stored for this version.</div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
