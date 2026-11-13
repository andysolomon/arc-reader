import { cn } from "../lib/cn";

export interface ProgressBarProps {
  /** 0..1, or null while the amount of work left is unknown */
  value: number | null;
  label: string;
  className?: string;
}

/** A thin bar for work under way. Without a value it sweeps instead of claiming a share. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const v = value === null ? null : Math.max(0, Math.min(1, value || 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={v === null ? undefined : 0}
      aria-valuemax={v === null ? undefined : 100}
      aria-valuenow={v === null ? undefined : Math.floor(v * 100)}
      className={cn("relative h-1.5 overflow-hidden rounded-pill bg-bg3", className)}
    >
      {v === null
        ? <div className="absolute inset-y-0 left-0 w-2/5 animate-sweep rounded-pill bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
        : <div className="h-full rounded-pill bg-accent transition-[width] duration-slow ease-out" style={{ width: `${v * 100}%` }} />}
    </div>
  );
}
