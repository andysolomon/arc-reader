import type { Theme } from "@readaloud/tokens";
import { cn } from "../lib/cn";

export interface ThemeSwatchProps {
  theme: Theme;
  selected?: boolean;
  onSelect: () => void;
  className?: string;
}

export function ThemeSwatch({ theme, selected, onSelect, className }: ThemeSwatchProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={!!selected}
      className={cn(
        "flex flex-col items-start gap-2.5 rounded-panel border bg-bg2 p-3 text-left text-fg transition-colors duration-fast",
        selected ? "border-accent" : "border-line hover:border-fg3",
        className,
      )}
    >
      <span className="flex gap-1" aria-hidden>
        {theme.swatches.map((c, i) => (
          <span key={i} className="size-3.5 rounded-[4px] border border-[rgba(128,128,128,.3)]" style={{ background: c }} />
        ))}
      </span>
      <span className="text-[13px]">{theme.name}</span>
    </button>
  );
}
