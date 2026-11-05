import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  interactive?: boolean;
  padding?: "none" | "sm" | "md";
  radius?: "panel" | "card";
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { selected, interactive, padding = "md", radius = "card", className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "border bg-bg2 transition-colors duration-fast",
        radius === "card" ? "rounded-card" : "rounded-panel",
        padding === "md" ? "p-[18px]" : padding === "sm" ? "p-3" : "",
        selected ? "border-accent" : "border-line",
        interactive && !selected && "hover:border-fg3",
        className,
      )}
      {...rest}
    />
  );
});
