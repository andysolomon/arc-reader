import { Link2 } from "lucide-react";
import { cn } from "../lib/cn";

export interface ToastProps {
  message: string | null;
  /** Makes the toast a link that opens this address in a new tab */
  href?: string | null;
  /** Lift above the player */
  offset?: number;
  className?: string;
}

const surface = "whitespace-nowrap rounded-[10px] bg-fg px-4 py-2.5 text-[13px] text-bg shadow-overlay animate-rise";

/** Inverted toast (fg on bg) that appears bottom-center above the player. */
export function Toast({ message, href, offset = 112, className }: ToastProps) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: offset }}>
      {message && href ? (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={href}
          className={cn(surface, "pointer-events-auto flex min-w-0 max-w-[560px] items-center gap-2 no-underline hover:underline", className)}
        >
          <Link2 size={15} strokeWidth={1.5} className="shrink-0" aria-hidden />
          <span className="sr-only">Link: </span>
          <span className="truncate">{message}</span>
        </a>
      ) : message ? (
        <div key={message} className={cn(surface, className)}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
