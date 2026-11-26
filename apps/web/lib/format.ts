import { normalizeValue } from "@lomi/core";
import type { FieldType } from "./types";

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
