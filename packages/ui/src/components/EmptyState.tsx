import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Dashed panel. "Nothing here matches. Clear filters" */
export function EmptyState({ children, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-card border border-dashed border-line px-6 py-16 text-center text-fg2", className)}>
      {children} {action}
    </div>
  );
}
