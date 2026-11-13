import { useEffect, useRef, useState, type RefObject } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@readaloud/ui";
import { serverReachable } from "../lib/appUpdate";
import { toast } from "../state/toast";

/** How far the finger travels before the indicator moves at all, so taps and small drags stay taps. */
const SLOP = 10;
/** Indicator travel (px) that reloads on release. */
export const PULL_THRESHOLD = 72;
const MAX_PULL = 110;

/** The finger's travel, damped so the indicator lags it like iOS's own pull. */
export const pullDistance = (dy: number) => Math.min(MAX_PULL, Math.max(0, dy - SLOP) * 0.5);

/** Touches that start here scroll, select or drag something of their own. */
const OWN_GESTURE = "textarea, input, select, [contenteditable], [role=slider], [role=dialog], [data-no-pull-refresh]";

/** True when the touch starts somewhere already scrolled to the top, all the way up to `root`. */
function atTop(target: Element, root: Element): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
    if (el === root) return true;
  }
  return true;
}

/**
 * Pull down from the top of a page to reload it, as in Safari. The app's pages
 * scroll inside `main` rather than the document, so the web view never offers
 * its own pull to refresh; this adds one for touch screens.
 */
export function PullToRefresh({ target }: { target: RefObject<HTMLElement | null> }) {
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const pullRef = useRef(0);

  useEffect(() => {
    const root = target.current;
    if (!root) return;
    let start: { x: number; y: number; el: Element } | null = null;
    let engaged = false;

    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const reset = () => {
      start = null;
      engaged = false;
      set(0);
    };

    const onStart = (e: TouchEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (e.touches.length !== 1 || !el || el.closest(OWN_GESTURE) || !atTop(el, root)) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, el };
      engaged = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) return reset();
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!engaged) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Sideways or upward: an ordinary scroll or swipe. Leave it alone.
        if (dy <= 0 || Math.abs(dx) > dy || !atTop(start.el, root)) {
          start = null;
          return;
        }
        engaged = true;
      }
      if (e.cancelable) e.preventDefault();
      set(pullDistance(dy));
    };

    const onEnd = () => {
      if (!start) return;
      const ready = engaged && pullRef.current >= PULL_THRESHOLD;
      start = null;
      engaged = false;
      if (!ready) return set(0);
      setReloading(true);
      set(PULL_THRESHOLD);
      // Reloading while the server is out of reach would swap a working page
      // for the "Can't reach ReadAloud" screen, so check first.
      void serverReachable().then((ok) => {
        if (ok) return location.reload();
        setReloading(false);
        set(0);
        toast("Can't reach ReadAloud right now. Check Tailscale, then pull again.", 5000);
      });
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", reset);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", reset);
    };
  }, [target]);

  if (!pull && !reloading) return null;
  const ready = pull >= PULL_THRESHOLD;
  return (
    <div
      data-testid="pull-to-refresh"
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
      style={{ transform: `translateY(${pull - 44}px)`, transition: pull === 0 || reloading ? "transform 200ms ease" : undefined }}
    >
      <span role="status" className="sr-only">
        {reloading ? "Checking the server" : ready ? "Release to reload" : "Pull to reload"}
      </span>
      <span
        aria-hidden
        className={cn("grid size-9 place-items-center rounded-full border border-line bg-bg2 shadow-md transition-colors", ready ? "text-accent" : "text-fg2")}
      >
        <RotateCw
          size={18}
          strokeWidth={1.75}
          className={cn(reloading && "animate-spin motion-reduce:animate-none")}
          style={reloading ? undefined : { transform: `rotate(${Math.min(1, pull / PULL_THRESHOLD) * 270}deg)`, opacity: 0.4 + 0.6 * Math.min(1, pull / PULL_THRESHOLD) }}
        />
      </span>
    </div>
  );
}
