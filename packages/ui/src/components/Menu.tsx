import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Popover } from "./Popover";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  label?: string;
  align?: "end" | "start" | "center";
  width?: number;
}

/** role="menu" with menuitem children, arrow-key navigation, Esc + outside click to close. */
export function Menu({ open, onClose, items, label = "More", align = "end", width = 240 }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      const first = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
      first?.focus();
    }
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Tab") {
      onClose();
    }
  };

  return (
    <Popover open={open} onClose={onClose} align={align} offset={52} className="p-1.5" style={{ width }}>
      <div ref={ref} role="menu" aria-label={label} onKeyDown={onKeyDown} className="flex flex-col">
        {items.map((it) => (
          <button
            key={it.id}
            role="menuitem"
            type="button"
            disabled={it.disabled}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              it.onSelect();
            }}
            className={cn(
              "flex h-[38px] items-center gap-2.5 rounded-control border-0 bg-transparent px-2.5 text-left text-[13px] hover:bg-bg3 disabled:opacity-50",
              it.danger ? "text-danger" : "text-fg",
            )}
          >
            {it.icon ? <span className="grid text-fg2">{it.icon}</span> : null}
            {it.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}
