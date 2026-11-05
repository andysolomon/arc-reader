import { cn } from "../lib/cn";

export interface ToastProps {
  message: string | null;
  /** Lift above the player */
  offset?: number;
  className?: string;
}

/** Inverted toast (fg on bg) that appears bottom-center above the player. */
export function Toast({ message, offset = 112, className }: ToastProps) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center" style={{ bottom: offset }}>
      {message ? (
        <div
          key={message}
          className={cn("whitespace-nowrap rounded-[10px] bg-fg px-4 py-2.5 text-[13px] text-bg shadow-overlay animate-rise", className)}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
