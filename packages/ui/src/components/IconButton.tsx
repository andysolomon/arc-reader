import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Also used as the tooltip. */
  label: string;
  size?: 32 | 36 | 44 | 48;
  active?: boolean;
  round?: boolean;
  tone?: "default" | "accent";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 36, active, round, tone = "default", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        "relative grid place-items-center border-0 transition-colors duration-fast",
        round ? "rounded-full" : "rounded-control",
        tone === "accent"
          ? "bg-accent text-accent-fg hover:scale-[1.04] active:scale-[.96] transition-transform motion-reduce:transform-none"
          : active
            ? "bg-bg3 text-fg"
            : "bg-transparent text-fg2 hover:bg-bg3 hover:text-fg",
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
});
