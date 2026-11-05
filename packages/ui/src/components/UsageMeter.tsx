import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface UsageMeterProps {
  used: number;
  limit: number;
  unit?: string;
  footer?: ReactNode;
  className?: string;
}

export function UsageMeter({ used, limit, unit = "characters this month", footer, className }: UsageMeterProps) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const near = pct >= 90;
  return (
    <div className={cn("flex flex-col gap-2.5 rounded-panel border border-line bg-bg2 p-4", className)}>
      <div className="flex justify-between tabular-nums">
        <span>
          {used.toLocaleString()} {unit}
        </span>
        <span className="text-fg2">of {limit.toLocaleString()}</span>
      </div>
      <div
        role="meter"
        aria-label={unit}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="h-1.5 overflow-hidden rounded-pill bg-bg3"
      >
        <div className={cn("h-full rounded-pill transition-[width] duration-slow", near ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      {footer ? <div className="flex items-center justify-between text-[13px] text-fg2">{footer}</div> : null}
    </div>
  );
}
