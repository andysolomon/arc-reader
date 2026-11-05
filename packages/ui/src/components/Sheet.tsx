import { useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

/** Bottom sheet for small screens (non-modal: Esc and backdrop close it). */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/30 animate-fadein" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[85dvh] w-full flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-card border border-b-0 border-line bg-bg2 p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-overlay animate-rise",
          className,
        )}
      >
        <div className="mx-auto -mt-1 h-1 w-9 rounded-pill bg-line" aria-hidden />
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="-my-3 -mr-3 border-0 bg-transparent p-3 text-[13px] text-fg2 hover:text-fg">
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
