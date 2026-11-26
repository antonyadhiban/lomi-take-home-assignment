import { Loader2 } from "lucide-react";
import type { ValueStatus, VersionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Midday-style status tag: small, square, bordered, monochrome; colour only via a dot. */
export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1.5 border px-1.5 text-[11px] leading-none whitespace-nowrap text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export const Dot = ({ className }: { className?: string }) => <span className={cn("size-1.5 shrink-0 rounded-full", className)} />;

const VERSION: Record<VersionStatus, { label: string; dot?: string; spin?: boolean }> = {
  queued: { label: "Queued", spin: true },
  extracting: { label: "Extracting", spin: true },
  extracted: { label: "Extracted", dot: "bg-approved" },
  failed: { label: "Failed", dot: "bg-gap" },
  superseded: { label: "Superseded", dot: "bg-muted-foreground" },
};

export function VersionStatusChip({ status, className }: { status: VersionStatus | null; className?: string }) {
  if (!status) return null;
  const s = VERSION[status];
  return (
    <Chip className={cn(status === "failed" && "border-gap/40 text-gap", className)}>
      {s.spin ? <Loader2 className="size-3 animate-spin" /> : <Dot className={s.dot} />}
      {s.label}
    </Chip>
  );
}

export const VALUE_META: Record<ValueStatus | "gap", { label: string; dot: string; text: string; hl: string }> = {
  pending: { label: "Needs review", dot: "bg-pending", text: "text-pending", hl: "var(--pending)" },
  approved: { label: "Approved", dot: "bg-approved", text: "text-approved", hl: "var(--approved)" },
  corrected: { label: "Corrected", dot: "bg-corrected", text: "text-corrected", hl: "var(--corrected)" },
  carried_over: { label: "Carried over", dot: "bg-carried", text: "text-carried", hl: "var(--carried)" },
  gap: { label: "Gap", dot: "bg-gap", text: "text-gap", hl: "var(--gap)" },
};

export function ValueStatusChip({ status, className }: { status: ValueStatus; className?: string }) {
  const m = VALUE_META[status];
  return (
    <Chip className={className}>
      <Dot className={m.dot} />
      {m.label}
    </Chip>
  );
}

/**
 * Status as a reviewer thinks about it: an extracted document is "Ready to
 * review" until every field is approved or corrected, then "Done".
 */
export function DocumentStatusChip({
  status,
  pending,
  className,
}: {
  status: VersionStatus | null;
  pending: number;
  className?: string;
}) {
  if (status !== "extracted") return <VersionStatusChip status={status} className={className} />;
  return pending > 0 ? (
    <Chip className={className}>
      <Dot className="bg-pending" /> Ready to review
    </Chip>
  ) : (
    <Chip className={cn("border-approved/40 text-approved", className)}>
      <Dot className="bg-approved" /> Done
    </Chip>
  );
}
