"use client";

import { useEffect, useMemo, useRef } from "react";
import { VALUE_META } from "@/components/app/status";
import { locate } from "@/lib/diff";
import { displayStatus, fieldLabel } from "@/lib/format";
import type { Value } from "@/lib/types";

/**
 * The version's parsed text, rendered as a page, with every evidence passage
 * highlighted in its review-state colour. Hovering a passage focuses its value
 * in the sidebar; clicking pins it.
 */
export function SourceDocument({
  text,
  values,
  focusedId,
  onHover,
  onSelect,
}: {
  text: string;
  values: Value[];
  focusedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLElement>());

  const segments = useMemo(() => {
    const ranges = values
      .filter((v) => v.evidence)
      .map((v) => ({ v, at: locate(text, v.evidence!) }))
      .filter((r): r is { v: Value; at: [number, number] } => r.at != null)
      .sort((a, b) => a.at[0] - b.at[0]);
    const out: { text: string; v?: Value }[] = [];
    let cursor = 0;
    for (const r of ranges) {
      if (r.at[0] < cursor) continue; // overlapping quotes: first wins
      if (r.at[0] > cursor) out.push({ text: text.slice(cursor, r.at[0]) });
      out.push({ text: text.slice(r.at[0], r.at[1]), v: r.v });
      cursor = r.at[1];
    }
    out.push({ text: text.slice(cursor) });
    return out;
  }, [text, values]);

  // keep the focused passage in view when focus comes from the sidebar or keyboard
  useEffect(() => {
    if (focusedId) refs.current.get(focusedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedId]);

  return (
    <article className="mx-auto w-full max-w-[760px] border bg-paper px-6 py-8 shadow-[0_1px_0_0_var(--border),0_12px_32px_-16px_rgb(0_0_0/0.18)] sm:px-12 sm:py-14">
      <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.9] text-foreground/90">
        {segments.map((s, i) => {
          if (!s.v) return <span key={i}>{s.text}</span>;
          const v = s.v;
          const meta = VALUE_META[displayStatus(v)];
          return (
            <mark
              key={i}
              ref={(el) => {
                if (el) refs.current.set(v.id, el);
                else refs.current.delete(v.id);
              }}
              className="evidence text-inherit"
              style={{ ["--hl" as string]: meta.hl }}
              data-active={focusedId === v.id}
              data-dim={focusedId != null && focusedId !== v.id}
              title={`${fieldLabel(v.field)} · ${meta.label}`}
              onMouseEnter={() => onHover(v.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(v.id)}
            >
              {s.text}
            </mark>
          );
        })}
      </div>
    </article>
  );
}
