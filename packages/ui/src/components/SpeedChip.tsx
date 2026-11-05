import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Popover } from "./Popover";

export const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2];
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;

export function clampSpeed(v: number): number {
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, v)) * 20) / 20;
}

export function formatSpeed(v: number): string {
  return `${Number(v.toFixed(2))}×`;
}

export interface SpeedChipProps {
  speed: number;
  onChange: (speed: number) => void;
  /** Hold duration before the slider opens */
  holdMs?: number;
  className?: string;
  size?: "sm" | "md";
}

/** Tap cycles 0.75/1/1.25/1.5/2. Hold or right-click opens a 0.5–3× slider (step 0.05). */
export function SpeedChip({ speed, onChange, holdMs = 420, className, size = "md" }: SpeedChipProps) {
  const [open, setOpen] = useState(false);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const cycle = () => {
    if (held.current) {
      held.current = false;
      return;
    }
    const i = SPEED_STEPS.indexOf(speed);
    onChange(i === -1 ? SPEED_STEPS.find((s) => s > speed) ?? SPEED_STEPS[0] : SPEED_STEPS[(i + 1) % SPEED_STEPS.length]);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={cycle}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          cancel();
          timer.current = setTimeout(() => {
            held.current = true;
            setOpen(true);
          }, holdMs);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        aria-label={`Speed ${formatSpeed(speed)}. Tap to cycle, hold for slider`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Speed · tap to cycle, hold for slider ([ ])"
        className={cn(
          "inline-flex items-center justify-center rounded-pill border border-line bg-transparent text-fg tabular-nums hover:bg-bg3 transition-colors duration-fast",
          size === "md" ? "h-[34px] min-w-[52px] px-2.5 text-[13px]" : "h-[30px] min-w-[48px] px-2 text-[12px]",
        )}
      >
        {formatSpeed(speed)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} role="dialog" aria-label="Playback speed" className="flex w-[220px] flex-col gap-1.5 px-3.5 py-3">
        <div className="flex justify-between text-[12px] text-fg2">
          <span>0.5×</span>
          <span className="tabular-nums text-fg">{formatSpeed(speed)}</span>
          <span>3×</span>
        </div>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          value={speed}
          onChange={(e) => onChange(clampSpeed(parseFloat(e.target.value)))}
          aria-label="Playback speed"
          className="w-full accent-accent"
          autoFocus
        />
      </Popover>
    </div>
  );
}
