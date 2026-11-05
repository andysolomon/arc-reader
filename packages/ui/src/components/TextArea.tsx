import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Large serif text area used by Compose. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full min-h-[220px] resize-y rounded-card border bg-bg2 px-[22px] py-5 font-serif text-[19px] leading-[1.6] text-fg",
        "transition-colors duration-base focus:border-fg3 focus-visible:outline-offset-0 disabled:opacity-50",
        invalid ? "border-danger" : "border-line",
        className,
      )}
      {...rest}
    />
  );
});
