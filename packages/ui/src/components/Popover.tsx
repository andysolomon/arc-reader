import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface PopoverProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  /** Horizontal alignment relative to the anchor wrapper */
  align?: "center" | "end" | "start";
  /** Distance above the anchor (px) */
  offset?: number;
  children: ReactNode;
}

/**
 * Anchored overlay rendered above its anchor. Closes on outside click or Esc.
 * Wrap the anchor and this component in a `relative` container.
 */
export function Popover({ open, onClose, align = "center", offset = 46, className, style, children, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el) return;
      const anchor = el.parentElement;
      if (anchor && e.target instanceof Node && anchor.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-20 rounded-panel border border-line bg-bg2 shadow-overlay animate-rise",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "end" && "right-0",
        align === "start" && "left-0",
        className,
      )}
      style={{ bottom: offset, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
