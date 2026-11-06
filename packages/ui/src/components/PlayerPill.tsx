import { cn } from "../lib/cn";
import { PlayerControls, type PlayerProps } from "./PlayerControls";

/** Floating listening dock with a quiet title row above the controls. */
export function PlayerPill(p: PlayerProps) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6 animate-rise-slow", p.className)}>
      <div
        role="region"
        aria-label="Player"
        className="pointer-events-auto w-full max-w-pillmax min-w-0 rounded-[24px] border border-line bg-bg2 p-3 shadow-overlay backdrop-blur-xl"
      >
        {p.title && <div className="mb-2 flex min-w-0 items-center gap-3 border-b border-line px-3 pb-2.5 text-[11px] text-fg2">
          <span className="min-w-0 flex-1 truncate text-fg">{p.title}</span>
          <span className="shrink-0">{p.voice.name}</span>
        </div>}
        <div className="flex min-w-0 items-center gap-1.5"><PlayerControls {...p} /></div>
      </div>
    </div>
  );
}
