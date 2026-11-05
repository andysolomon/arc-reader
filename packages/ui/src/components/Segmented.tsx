import { cn } from "../lib/cn";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-[30px] min-w-[44px] rounded-[6px] border px-2 text-[12px] tabular-nums transition-colors duration-fast",
              on ? "border-fg bg-fg text-bg" : "border-line bg-transparent text-fg2 hover:bg-bg3",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
