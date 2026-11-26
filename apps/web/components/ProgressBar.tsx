import type { Progress } from "@/lib/types";

const SEGMENTS = [
  ["approved", "Approved"],
  ["corrected", "Corrected"],
  ["carried_over", "Carried over"],
] as const;

export function ProgressBar({ progress, legend = false }: { progress: Progress; legend?: boolean }) {
  const { total } = progress;
  return (
    <div>
      <div
        className="progress"
        role="img"
        aria-label={`${total - progress.pending} of ${total} reviewed`}
        title={`${progress.approved} approved · ${progress.corrected} corrected · ${progress.carried_over} carried over · ${progress.pending} pending`}
      >
        {total > 0 && SEGMENTS.map(([k]) => <span key={k} className={`p-${k}`} style={{ width: `${(progress[k] / total) * 100}%` }} />)}
      </div>
      {legend && (
        <div className="legend" style={{ marginTop: 6 }}>
          {SEGMENTS.map(([k, label]) => (
            <span key={k}>
              <i className={`p-${k}`} />
              {progress[k]} {label.toLowerCase()}
            </span>
          ))}
          <span>
            <i style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            {progress.pending} pending
          </span>
        </div>
      )}
    </div>
  );
}
