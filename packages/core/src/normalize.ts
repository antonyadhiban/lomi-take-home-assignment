import type { FieldType } from "./fields.js";

/**
 * Text normalization used for evidence matching. PDF text extraction is
 * inconsistent about whitespace, ligatures and typographic quotes, so we fold
 * those — but we do NOT fold case or digits: evidence must still be verbatim
 * in every way a human reviewer would notice.
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical form of a value for equality checks across versions
 * (e.g. "$5,230.29" and "5230.29" are the same money value).
 * Returns null when the raw value can't be interpreted as its type.
 */
export function normalizeValue(type: FieldType, raw: string | null): string | null {
  if (raw == null) return null;
  const s = normalizeText(raw);
  if (s === "") return null;
  switch (type) {
    case "string":
      return s;
    case "money":
    case "number":
    case "percent": {
      const n = Number(s.replace(/[$€£,%\s]|USD/gi, ""));
      if (!Number.isFinite(n)) return null;
      return type === "money" ? n.toFixed(2) : String(n);
    }
    case "date": {
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (iso) return s;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
  }
}
