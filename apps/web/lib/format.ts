import { normalizeValue } from "@lomi/core";
import type { FieldType, Progress, Value, ValueStatus } from "./types";

export const fieldLabel = (field: string) =>
  field.replace(/_/g, " ").replace(/\b1br\b/i, "1BR").replace(/^\w/, (c) => c.toUpperCase());

export const typeLabel = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Display a stored value consistently by type ("6126.45" and "$6,126.45" both show as $6,126.45). */
export function formatValue(type: FieldType, raw: string | null): string {
  if (raw == null) return "—";
  const n = normalizeValue(type, raw);
  if (n == null) return raw;
  switch (type) {
    case "money":
      return money.format(Number(n));
    case "percent":
      return `${n}%`;
    case "date":
      return new Date(`${n}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
    default:
      return n;
  }
}

export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};


export type DisplayStatus = Exclude<ValueStatus, "carried_over">;

/**
 * How a value is shown outside the detail panel. A carried-over value is
 * simply as reviewed as the review it inherited (approved or corrected);
 * "carried over" is provenance, shown only in the detail panel.
 */
export function displayStatus(v: Value): DisplayStatus {
  if (v.status !== "carried_over") return v.status;
  return v.history.at(-1)?.state === "corrected" ? "corrected" : "approved";
}

export function displayProgress(values: Value[]): Progress {
  const p: Progress = { total: values.length, pending: 0, approved: 0, corrected: 0, carried_over: 0, gaps: 0 };
  for (const v of values) {
    p[displayStatus(v)]++;
    if (v.isGap) p.gaps++;
  }
  return p;
}
