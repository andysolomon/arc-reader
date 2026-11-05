import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  pill?: boolean;
}

const sizes: Record<ButtonSize, string> = {
  sm: "h-[34px] px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-[14px] gap-2",
  lg: "h-[46px] px-4 text-[15px] gap-2",
  xl: "h-[52px] pl-[22px] pr-[10px] text-[16px] gap-3 font-semibold",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border-0 font-semibold transition-transform duration-fast ease-out hover:-translate-y-px active:scale-[.98] motion-reduce:transform-none",
  secondary: "bg-bg2 text-fg border border-line hover:bg-bg3",
  ghost: "bg-transparent text-fg2 border-0 hover:bg-bg3 hover:text-fg",
  danger: "bg-transparent text-danger border border-line hover:bg-bg3",
  link: "bg-transparent text-fg2 border-0 p-0 h-auto hover:text-fg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", loading, leading, trailing, pill, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap select-none",
        pill ? "rounded-pill" : size === "xl" ? "rounded-panel" : "rounded-control",
        variant !== "link" && sizes[size],
        variants[variant],
        (disabled || loading) && "opacity-50 pointer-events-none",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : leading ? <span className="grid text-fg2 [.bg-accent_&]:text-accent-fg">{leading}</span> : null}
      {children}
      {trailing ? <span className="grid">{trailing}</span> : null}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 rounded-full border-[1.5px] border-current border-r-transparent animate-spin motion-reduce:animate-none"
    />
  );
}
