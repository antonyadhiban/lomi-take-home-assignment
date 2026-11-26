import type { ValueStatus, VersionStatus } from "@/lib/types";

const VERSION_LABEL: Record<VersionStatus, string> = {
  queued: "Queued",
  extracting: "Extracting",
  extracted: "Extracted",
  failed: "Failed",
  superseded: "Superseded",
};

export function VersionBadge({ status }: { status: VersionStatus | null }) {
  if (!status) return null;
  const live = status === "queued" || status === "extracting";
  return (
    <span className={`badge b-${status} ${live ? "pulse" : ""}`}>
      {live && <span className="dot" />}
      {VERSION_LABEL[status]}
    </span>
  );
}

const VALUE_LABEL: Record<ValueStatus, string> = {
  pending: "Needs review",
  approved: "Approved",
  corrected: "Corrected",
  carried_over: "Carried over",
};

export function ValueBadge({ status }: { status: ValueStatus }) {
  return <span className={`badge b-${status}`}>{VALUE_LABEL[status]}</span>;
}
