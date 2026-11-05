import { cn } from "../lib/cn";

export interface ProgressRingProps {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
}

export function ProgressRing({ value, size = 36, stroke = 2.5, label, className }: ProgressRingProps) {
  const r = size / 2 - stroke * 1.6;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? `${Math.round(v * 100)}% listened`}
      className={cn("block shrink-0", className)}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${v * c} ${c}`}
        style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", transition: "stroke-dasharray .3s ease-out" }}
      />
    </svg>
  );
}
