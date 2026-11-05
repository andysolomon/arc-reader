import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function SectionLabel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-[12px] uppercase tracking-[.08em] text-fg2", className)} {...rest} />;
}
