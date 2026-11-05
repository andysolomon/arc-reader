import { cn } from "../lib/cn";

export interface WaveformProps {
  active: boolean;
  className?: string;
}

const HEIGHTS = [8, 14, 10, 16, 7];

/** 5-bar waveform; animates while a preview plays. */
export function Waveform({ active, className }: WaveformProps) {
  return (
    <span aria-hidden className={cn("inline-flex h-4 w-[18px] items-center gap-[2px]", className)}>
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={cn("w-[2px] rounded-[1px] origin-center transition-colors duration-base", active ? "bg-accent" : "bg-fg3")}
          style={{
            height: h,
            transform: active ? undefined : "scaleY(.4)",
            animation: active ? `ra-wave ${0.7 + i * 0.08}s ease-in-out ${i * 0.08}s infinite` : "none",
          }}
        />
      ))}
    </span>
  );
}
