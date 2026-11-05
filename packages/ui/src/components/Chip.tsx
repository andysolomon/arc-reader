import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Non-interactive tag chip */
  tag?: boolean;
  size?: "sm" | "md";
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, leading, trailing, tag, size = "md", className, children, ...rest },
  ref,
) {
  if (tag) {
    return (
      <span className={cn("inline-flex items-center rounded-pill bg-bg3 px-2 py-[3px] text-[12px] text-fg", className)}>{children}</span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-pill border text-[13px] whitespace-nowrap transition-colors duration-fast tabular-nums",
        size === "sm" ? "h-[30px] px-3" : "h-[34px] px-3",
        leading ? "pl-1.5" : "",
        selected ? "border-fg bg-fg text-bg" : "border-line bg-bg2 text-fg hover:bg-bg3",
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
});
