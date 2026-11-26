"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface Stage {
  label: string;
  value: number;
  /** shown in the tooltip, e.g. "1 still extracting" */
  detail?: string;
}

const H = 160; // bar area height (px, in viewBox units)
const W = 1000;

/**
 * Funnel of how far documents have got: hatched bars per stage joined by
 * slanted connectors; hovering a column makes it solid and shows its numbers.
 */
export function PipelineChart({ stages, unit = "documents" }: { stages: Stage[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...stages.map((s) => s.value));
  const colW = W / stages.length;
  const barW = colW * 0.72;
  const y = (v: number) => H - (v / max) * (H - 12);
  const first = stages[0]?.value ?? 0;

  return (
    <div className="relative">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s, i) => (
          <div key={s.label} className={cn("border-l px-4 pt-1 pb-3 transition-colors first:border-l-0", hover === i && "bg-accent/60")}>
            <p className={cn("text-xs", hover === i ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
            <p className={cn("mt-1 font-serif text-4xl tabular-nums", hover === null || hover === i ? "text-foreground" : "text-muted-foreground")}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-40 w-full" aria-hidden>
          <defs>
            <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--foreground)" fillOpacity="0.06" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--foreground)" strokeOpacity="0.55" strokeWidth="2.2" />
            </pattern>
            <linearGradient id="col" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--foreground)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--foreground)" stopOpacity="0.06" />
            </linearGradient>
          </defs>
          {stages.map((s, i) => {
            const x = i * colW;
            const top = y(s.value);
            const next = stages[i + 1];
            return (
              <g key={s.label}>
                {hover === i && <rect x={x} y={0} width={colW} height={H} fill="url(#col)" />}
                <line x1={x} y1={0} x2={x} y2={H} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity={i === 0 ? 0 : 1} />
                {/* connector slants down to the next stage's bar */}
                {next && (
                  <polygon
                    points={`${x + barW},${top} ${x + colW},${y(next.value)} ${x + colW},${H} ${x + barW},${H}`}
                    fill="var(--foreground)"
                    fillOpacity={0.07}
                  />
                )}
                <rect
                  x={x}
                  y={top}
                  width={barW}
                  height={H - top}
                  fill={hover === i ? "var(--foreground)" : "url(#hatch)"}
                  fillOpacity={hover === i ? 0.9 : 1}
                />
                <rect x={x + barW / 2 - 14} y={Math.max(2, top - 9)} width={28} height={3} rx={1.5} fill="var(--foreground)" fillOpacity={0.35} />
              </g>
            );
          })}
        </svg>

        {/* hover targets per column */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => (
            <div key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </div>

        {hover !== null && stages[hover] && (
          <div
            className="pointer-events-none absolute top-6 z-10 -translate-x-1/2 border bg-popover px-3 py-1.5 text-xs whitespace-nowrap shadow-md"
            style={{ left: `${((hover + 0.5) / stages.length) * 100}%` }}
          >
            <span className="font-medium tabular-nums">{stages[hover]!.value}</span> {unit}
            {hover > 0 && first > 0 && (
              <>
                <span className="text-muted-foreground"> | of uploaded: </span>
                <span className="font-medium tabular-nums">{Math.round((stages[hover]!.value / first) * 100)}%</span>
                <span className="text-muted-foreground"> | drop-off: </span>
                <span className="font-medium tabular-nums">{stages[hover - 1]!.value - stages[hover]!.value ? `-${stages[hover - 1]!.value - stages[hover]!.value}` : "0"}</span>
              </>
            )}
            {stages[hover]!.detail && <span className="text-muted-foreground"> · {stages[hover]!.detail}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
