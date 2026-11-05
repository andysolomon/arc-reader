import { cn } from "../lib/cn";
import { PlayerControls, type PlayerProps } from "./PlayerControls";

/** Floating capsule: max 760px wide, 64px tall, 24px from the bottom, centered. */
export function PlayerPill(p: PlayerProps) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6 animate-rise-slow", p.className)}>
      <div
        role="region"
        aria-label="Player"
        className="pointer-events-auto flex h-pill w-full max-w-pillmax min-w-0 items-center gap-1.5 rounded-pill border border-line bg-bg2 px-2.5 shadow-overlay"
      >
        <PlayerControls {...p} />
      </div>
    </div>
  );
}
