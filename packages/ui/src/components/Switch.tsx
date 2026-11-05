import { cn } from "../lib/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-[26px] w-11 shrink-0 items-center rounded-pill border-0 p-[3px] transition-colors duration-base disabled:opacity-50",
        checked ? "bg-accent" : "bg-bg3",
        className,
      )}
    >
      <span
        className={cn("block size-5 rounded-full transition-transform duration-base ease-out", checked ? "translate-x-[18px] bg-accent-fg" : "bg-fg2")}
      />
    </button>
  );
}
