import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { IconButton, Popover, cn } from "@readaloud/ui";

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/** How an icon looks while what it stands for is narrowing or changing the list. */
export const ICON_ON = "!bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] !text-accent";

/**
 * An icon that opens its choices beneath it: a row of these holds what a row of chips
 * would, in the space of one line. `on` marks a choice other than the default.
 */
export function IconMenu({ label, icon, on, size = 36, width = 240, align = "end", children }: {
  /** Names the button and its menu */
  label: string;
  icon: ReactNode;
  on?: boolean;
  size?: 36 | 44;
  width?: number;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    // Focus goes back to the button only when it was in the menu, so a press elsewhere keeps its own focus.
    if (list.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const items = list.current?.querySelectorAll<HTMLButtonElement>(ITEMS);
    (list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items?.[0])?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <IconButton ref={trigger} label={label} size={size} aria-haspopup="menu" aria-expanded={open} data-on={on || undefined} onClick={() => setOpen((o) => !o)} className={cn(open && "bg-bg3 text-fg", on && ICON_ON)}>
        {icon}
      </IconButton>
      <Popover open={open} onClose={close} side="bottom" align={align} offset={size + 6} className="z-30 max-w-[calc(100vw-24px)] p-1.5" style={{ width }}>
        <div ref={list} role="menu" aria-label={label} onKeyDown={onKeyDown} className="flex max-h-[min(60dvh,440px)] flex-col overflow-y-auto overscroll-contain">
          {children(close)}
        </div>
      </Popover>
    </div>
  );
}

const ITEM = "flex min-h-10 w-full shrink-0 items-center gap-2 rounded-control border-0 bg-transparent px-2 py-1.5 text-left text-[14px] text-fg hover:bg-bg3 focus-visible:bg-bg3 disabled:opacity-50";

/** One of a set of choices, ticked when it is the one in force. */
export function MenuOption({ checked, onSelect, count, children }: { checked: boolean; onSelect: () => void; /** How many documents the choice holds */ count?: number; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} onClick={onSelect} className={cn(ITEM, checked && "font-medium")}>
      <span aria-hidden className="grid w-4 shrink-0 place-items-center text-accent">{checked && <Check size={15} strokeWidth={2.25} />}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="shrink-0 text-[12px] font-normal tabular-nums text-fg2">{count}</span>}
    </button>
  );
}

/** Something the menu does, as opposed to a choice it keeps. */
export function MenuAction({ icon, onSelect, disabled, children }: { icon: ReactNode; onSelect: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onSelect} className={cn(ITEM, "text-fg2 hover:text-fg")}>
      <span aria-hidden className="grid w-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** Choices that belong together, under a quiet heading. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <div aria-hidden className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-[.08em] text-fg3">{label}</div>
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div role="separator" className="mx-1 my-1.5 h-px shrink-0 bg-line" />;
}
