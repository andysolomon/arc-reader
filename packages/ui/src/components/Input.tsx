import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ leading, className, wrapperClassName, ...rest }, ref) {
  if (leading) {
    return (
      <label className={cn("flex h-9 items-center gap-2 rounded-control border border-line bg-bg2 px-3 text-fg2 focus-within:border-fg3", wrapperClassName)}>
        <span className="grid">{leading}</span>
        <input ref={ref} className={cn("min-w-0 flex-1 border-0 bg-transparent text-fg outline-none", className)} {...rest} />
      </label>
    );
  }
  return (
    <input
      ref={ref}
      className={cn("h-10 rounded-control border border-line bg-bg2 px-3.5 text-fg transition-colors focus:border-fg3 focus-visible:outline-offset-0", className)}
      {...rest}
    />
  );
});
