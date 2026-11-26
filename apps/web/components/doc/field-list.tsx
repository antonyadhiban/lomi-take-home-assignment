"use client";

import { Dot, VALUE_META } from "@/components/app/status";
import { fieldLabel, formatValue } from "@/lib/format";
import type { Value } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Compact list of every field; hovering previews it, clicking pins it. */
export function FieldList({
  values,
  focusedId,
  selectedId,
  onHover,
  onSelect,
}: {
  values: Value[];
  focusedId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-y border-y">
      {values.map((v) => {
        const meta = VALUE_META[v.status];
        const shown = v.status === "corrected" || v.history.at(-1)?.state === "corrected" ? v.effectiveValue : v.value;
        return (
          <li key={v.id}>
            <button
              type="button"
              onMouseEnter={() => onHover(v.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(v.id)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent",
                focusedId === v.id && "bg-accent",
                selectedId === v.id && "shadow-[inset_2px_0_0_var(--foreground)]",
              )}
            >
              <Dot className={meta.dot} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-muted-foreground">{fieldLabel(v.field)}</span>
                <span className={cn("block truncate", v.isGap && !shown && "text-gap")}>
                  {v.isGap && !shown ? "Not found" : formatValue(v.type, shown)}
                </span>
              </span>
              {v.needsReReview && v.status === "pending" && (
                <span className="border px-1 text-[10px] text-pending">changed</span>
              )}
              {v.isGap && <span className="border px-1 text-[10px] text-gap">gap</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
