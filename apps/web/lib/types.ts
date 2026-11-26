/** JSON shapes returned by the API (dates arrive as ISO strings). */
export type VersionStatus = "queued" | "extracting" | "extracted" | "failed" | "superseded";
export type ValueStatus = "pending" | "approved" | "corrected" | "carried_over";
export type ReviewState = "pending" | "approved" | "corrected";
export type FieldType = "string" | "date" | "money" | "number" | "percent";

export interface Progress {
  total: number;
  pending: number;
  approved: number;
  corrected: number;
  carried_over: number;
  gaps: number;
}

export interface DocumentSummary {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  currentVersion: number | null;
  status: VersionStatus | null;
  error: string | null;
  latestExtractedVersion: number | null;
  progress: Progress;
}

export interface ReviewEvent {
  id: string;
  kind: "approved" | "corrected" | "restored" | "carried_over";
  state: ReviewState;
  resultValue: string | null;
  note: string | null;
  reviewer: string;
  sourceEventId: string | null;
  createdAt: string;
}

export interface Value {
  id: string;
  field: string;
  type: FieldType;
  value: string | null;
  evidence: string | null;
  gapReason: string | null;
  isGap: boolean;
  status: ValueStatus;
  effectiveValue: string | null;
  note: string | null;
  latestEventId: string | null;
  history: ReviewEvent[];
  previous: {
    versionNumber: number;
    value: string | null;
    evidence: string | null;
    gapReason: string | null;
    status: ValueStatus;
    effectiveValue: string | null;
    note: string | null;
  } | null;
  needsReReview: boolean;
}

export interface DocumentDetail {
  id: string;
  type: string;
  title: string;
  currentVersion: number;
  status: VersionStatus;
  versions: { version: number; status: VersionStatus; error: string | null; createdAt: string }[];
  version: {
    version: number;
    status: VersionStatus;
    error: string | null;
    isCurrent: boolean;
    parsedText: string | null;
    lastRun: { id: string; attempt: number; status: string; model: string | null; error: string | null; finishedAt: string | null } | null;
  };
  values: Value[];
  progress: Progress;
}

export type ReviewInput =
  | { action: "approve"; note?: string }
  | { action: "correct"; value: string; note?: string }
  | { action: "restore"; eventId: string }
  | { action: "reset" };
