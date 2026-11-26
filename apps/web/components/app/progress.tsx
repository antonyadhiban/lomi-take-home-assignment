import type { Progress } from "@/lib/types";

const SEG = [
  ["approved", "bg-approved"],
  ["corrected", "bg-corrected"],
  ["carried_over", "bg-carried"],
] as const;

/** Thin segmented bar: reviewed share by kind; the empty remainder is what's pending. */
export function ProgressBar({ progress, className }: { progress: Progress; className?: string }) {
  const { total } = progress;
  return (
    <div
      className={`flex h-1 w-full overflow-hidden bg-muted ${className ?? ""}`}
      role="img"
      aria-label={`${total - progress.pending} of ${total} reviewed`}
    >
      {total > 0 && SEG.map(([k, cls]) => <span key={k} className={cls} style={{ width: `${(progress[k] / total) * 100}%` }} />)}
    </div>
  );
}
