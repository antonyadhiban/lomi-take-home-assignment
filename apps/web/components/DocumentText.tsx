"use client";

import { useEffect, useMemo, useRef } from "react";

interface Quote {
  id: string;
  evidence: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Find a quote in raw PDF text, tolerating the whitespace/line-break differences evidence validation also tolerates. */
function locate(text: string, quote: string): [number, number] | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map(escape);
  if (!words.length) return null;
  const m = new RegExp(words.join("\\s+")).exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

/**
 * The version's parsed text with every evidence passage marked; the selected
 * value's passage is emphasized and scrolled into view.
 */
export function DocumentText({
  text,
  quotes,
  activeId,
  onSelect,
}: {
  text: string;
  quotes: Quote[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const activeRef = useRef<HTMLElement>(null);

  const segments = useMemo(() => {
    const ranges = quotes
      .map((q) => ({ id: q.id, at: locate(text, q.evidence) }))
      .filter((r): r is { id: string; at: [number, number] } => r.at != null)
      .sort((a, b) => a.at[0] - b.at[0]);
    const out: { text: string; id?: string }[] = [];
    let cursor = 0;
    for (const r of ranges) {
      if (r.at[0] < cursor) continue; // overlapping quotes: keep the first
      if (r.at[0] > cursor) out.push({ text: text.slice(cursor, r.at[0]) });
      out.push({ text: text.slice(r.at[0], r.at[1]), id: r.id });
      cursor = r.at[1];
    }
    out.push({ text: text.slice(cursor) });
    return out;
  }, [text, quotes]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId]);

  return (
    <pre>
      {segments.map((s, i) =>
        s.id ? (
          <mark
            key={i}
            ref={s.id === activeId ? activeRef : undefined}
            className={s.id === activeId ? "active" : undefined}
            onClick={() => onSelect(s.id!)}
            style={{ cursor: "pointer" }}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </pre>
  );
}
