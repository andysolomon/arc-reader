import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  initialFocus?: "first" | "dialog";
  children: ReactNode;
  className?: string;
}

/** The only modal in the product (keyboard shortcuts). Esc and backdrop close it; focus is trapped. */
export function Dialog({ open, onClose, title, hint = "Esc to close", initialFocus = "first", children, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement;
    const el = ref.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])') ?? []);
    (initialFocus === "dialog" ? el : focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) {
          e.preventDefault();
          return;
        }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      (prev.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose, initialFocus]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 animate-fadein" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex w-[min(520px,calc(100%-48px))] flex-col gap-4 rounded-card border border-line bg-bg2 p-6 shadow-overlay animate-rise outline-none",
          className,
        )}
      >
        <div className="flex items-center justify-between">
          <div className="font-serif text-[20px]">{title}</div>
          <span className="text-[12px] text-fg2">{hint}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
