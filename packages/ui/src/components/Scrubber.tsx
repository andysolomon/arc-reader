import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "../lib/cn";

export interface ScrubberProps {
  /** 0..1 */
  value: number;
  /** Sentence boundaries as 0..1 fractions (ticks) */
  ticks?: number[];
  onSeek: (fraction: number) => void;
  /** Step used by arrow keys */
  step?: number;
  label?: string;
  /** Text for aria-valuetext, e.g. "2:10 of 6:52" */
  valueText?: string;
  disabled?: boolean;
  className?: string;
}

export function Scrubber({ value, ticks = [], onSeek, step = 0.02, label = "Progress", valueText, disabled, className }: ScrubberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;

  const fromEvent = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const r = ref.current!.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    },
    [],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    (e.currentTarget as HTMLDivElement).focus();
    onSeek(fromEvent(e));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(1, value + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, value - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    else if (e.key === "PageUp") next = Math.min(1, value + step * 5);
    else if (e.key === "PageDown") next = Math.max(0, value - step * 5);
    if (next !== null) {
      e.preventDefault();
      onSeek(next);
    }
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn("relative flex h-hit min-w-[120px] flex-1 cursor-pointer items-center touch-none select-none", disabled && "cursor-default opacity-50", className)}
    >
      <div className="relative h-1 w-full rounded-[2px] bg-bg3">
        {ticks.map((t, i) => (
          <span key={i} aria-hidden className="absolute -top-px h-1.5 w-px bg-fg3 opacity-50" style={{ left: `${t * 100}%` }} />
        ))}
        <div className="absolute left-0 top-0 h-full rounded-[2px] bg-accent" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_3px_var(--bg2)]"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
