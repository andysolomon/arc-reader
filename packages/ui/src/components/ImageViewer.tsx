import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, LayoutGrid, X } from "lucide-react";
import { cn } from "../lib/cn";

export interface ViewerItem {
  key: string;
  /** What the picture is of, shown under it and read as its name */
  title: string;
  /** What it shows, or the source's caption */
  caption?: string;
  /** The picture at full size. It is given the whole stage, a box with `container-type: size`, and fits itself inside it. */
  view: ReactNode;
  /** The picture small, for the gallery; the full-size one when left out */
  thumb?: ReactNode;
}

export interface ImageViewerProps {
  items: readonly ViewerItem[];
  /** The picture shown, or "grid" for all of them at once; null when closed */
  at: number | "grid" | null;
  onChange: (at: number | "grid" | null) => void;
  /** Names the gallery, e.g. "Covers" */
  label?: string;
  /** Said under the gallery's name, e.g. how many are still being drawn */
  note?: string;
}

/**
 * Pictures full screen, one at a time or all at once in a grid. Esc closes (from a picture opened
 * out of the grid it goes back to the grid), the arrow keys and a swipe step through them. The
 * screen is dark whatever the theme, so every picture is seen against the same ground.
 */
/** A picture that fits the viewer's stage whatever its shape. */
export function ViewerImage({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} decoding="async" referrerPolicy="no-referrer" className="block rounded-[6px] object-contain" style={{ maxWidth: "100cqw", maxHeight: "100cqh" }} />;
}

export function ImageViewer({ items, at, onChange, label = "Images", note }: ImageViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  const [fromGrid, setFromGrid] = useState(false);
  const open = at !== null && items.length > 0;
  const index = typeof at === "number" ? Math.min(Math.max(at, 0), items.length - 1) : -1;
  const item = index >= 0 ? items[index] : undefined;
  const grid = at === "grid";
  const many = items.length > 1;
  const step = (by: number) => { if (index >= 0 && many) onChange((index + by + items.length) % items.length); };
  // From a picture opened out of the grid, Esc goes back to the grid.
  const close = () => onChange(fromGrid && !grid && many ? "grid" : null);

  useEffect(() => { if (grid) setFromGrid(true); else if (at === null) setFromGrid(false); }, [at, grid]);

  // The latest handlers, so the key listener is added once per opening and never sees stale ones.
  const keys = useRef({ step, close });
  keys.current = { step, close };
  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement;
    ref.current?.focus();
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]),[tabindex]:not([tabindex='-1'])") ?? []);
    const onKey = (e: KeyboardEvent) => {
      // Nothing reaches the page underneath while this is open: no playing, seeking or focus mode.
      if (e.key !== "Tab") e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); keys.current.close(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); keys.current.step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); keys.current.step(1); }
      else if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      (prev.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // A swipe across the picture steps to the next or the one before.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  if (!open) return null;
  const button = "grid size-11 shrink-0 place-items-center rounded-full border-0 bg-white/10 text-white transition-colors duration-fast hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={grid ? label : item ? item.title : label}
      tabIndex={-1}
      data-image-viewer={grid ? "grid" : "single"}
      className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0e] font-sans text-white outline-none animate-fadein"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
        <div className="min-w-0 flex-1 px-1">
          <p className="m-0 truncate text-[13px] font-medium">{label}</p>
          <p className="m-0 truncate font-mono text-[11px] tabular-nums text-white/60" aria-live="polite">
            {grid ? `${items.length} ${items.length === 1 ? "picture" : "pictures"}${note ? ` · ${note}` : ""}` : `${index + 1} of ${items.length}`}
          </p>
        </div>
        {!grid && many && (
          <button type="button" aria-label="All pictures" title="All pictures" onClick={() => onChange("grid")} className={button}>
            <LayoutGrid size={18} strokeWidth={1.5} />
          </button>
        )}
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={() => onChange(null)} className={button}>
          <X size={20} strokeWidth={1.5} />
        </button>
      </div>

      {grid ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-2 sm:px-6">
          <ul className="m-0 mx-auto grid max-w-[1100px] list-none grid-cols-[repeat(auto-fill,minmax(min(150px,40vw),1fr))] gap-x-4 gap-y-6 p-0 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {items.map((entry, i) => (
              <li key={entry.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onChange(i)}
                  className="group flex w-full flex-col gap-2 rounded-[12px] border-0 bg-transparent p-0 text-left text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  <span className="block w-full transition-transform duration-base ease-out group-hover:-translate-y-0.5 motion-reduce:transform-none">{entry.thumb ?? entry.view}</span>
                  <span className="line-clamp-2 px-0.5 text-[12px] leading-snug text-white/75 group-hover:text-white">{entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : item ? (
        <>
          <div className="relative flex min-h-0 flex-1 items-center gap-2 px-2 sm:gap-4 sm:px-4">
            {many && (
              <button type="button" aria-label="Previous picture" title="Previous (←)" onClick={() => step(-1)} className={cn(button, "hidden sm:grid")}>
                <ChevronLeft size={22} strokeWidth={1.5} />
              </button>
            )}
            <div
              className="relative h-full min-w-0 flex-1 py-2"
              style={{ touchAction: "pinch-zoom" }}
              onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
              onPointerUp={(e) => {
                const start = swipe.current;
                swipe.current = null;
                if (!start) return;
                const dx = e.clientX - start.x, dy = e.clientY - start.y;
                if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
                // A tap on the dark around the picture closes it, as it would a lightbox anywhere.
                else if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && e.target === e.currentTarget) close();
              }}
              onPointerCancel={() => { swipe.current = null; }}
            >
              <div
                key={item.key}
                data-viewer-stage
                className="pointer-events-none grid size-full place-items-center animate-fadein [&>*]:pointer-events-auto"
                style={{ containerType: "size" }}
              >
                {item.view}
              </div>
            </div>
            {many && (
              <button type="button" aria-label="Next picture" title="Next (→)" onClick={() => step(1)} className={cn(button, "hidden sm:grid")}>
                <ChevronRight size={22} strokeWidth={1.5} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3 px-4 pb-4 pt-2 sm:px-6">
            {many && (
              <button type="button" aria-label="Previous picture" onClick={() => step(-1)} className={cn(button, "sm:hidden")}>
                <ChevronLeft size={22} strokeWidth={1.5} />
              </button>
            )}
            <div className="mx-auto min-w-0 max-w-[62ch] flex-1 text-center">
              <p className="m-0 line-clamp-2 text-[14px] font-medium leading-snug">{item.title}</p>
              {item.caption && <p className="m-0 mt-1 line-clamp-3 text-[12px] leading-relaxed text-white/65">{item.caption}</p>}
            </div>
            {many && (
              <button type="button" aria-label="Next picture" onClick={() => step(1)} className={cn(button, "sm:hidden")}>
                <ChevronRight size={22} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
