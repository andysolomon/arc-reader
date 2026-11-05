import { cn } from "../lib/cn";
import { PlayerControls, PlayButton, TimeReadout, type PlayerProps } from "./PlayerControls";
import { Scrubber } from "./Scrubber";
import { IconButton } from "./IconButton";
import { SkipBack, SkipForward, MoreHorizontal } from "lucide-react";
import { SpeedChip } from "./SpeedChip";
import { Menu } from "./Menu";
import { buildMenuItems } from "./PlayerControls";
import { fmtTime } from "../lib/format";
import { VoiceAvatar } from "./VoiceAvatar";

/** Full-width bar, 72px tall. `compact` renders the one-handed mobile layout (scrubber above controls). */
export function PlayerBar(p: PlayerProps) {
  if (p.compact) {
    return (
      <div
        role="region"
        aria-label="Player"
        className={cn("absolute inset-x-0 bottom-0 z-10 flex flex-col border-t border-line bg-bg2 px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-1 animate-rise-slow shadow-[0_-8px_30px_-16px_rgba(0,0,0,.4)]", p.className)}
      >
        <div className="flex items-center gap-2">
          <Scrubber value={p.progress} ticks={p.ticks} onSeek={p.onSeek} valueText={`${fmtTime(p.elapsed)} elapsed, ${fmtTime(p.remaining)} remaining`} className="h-8" />
          <TimeReadout elapsed={p.elapsed} remaining={p.remaining} />
        </div>
        <div className="flex items-center justify-between gap-1">
          <VoiceAvatar voice={p.voice} size={36} interactive onClick={p.onVoice} />
          <SpeedChip speed={p.speed} onChange={p.onSpeed} />
          <div className="flex items-center gap-1">
            <IconButton label="Previous sentence" size={44} round onClick={p.onPrev}>
              <SkipBack size={20} strokeWidth={1.5} />
            </IconButton>
            <PlayButton playing={p.playing} loading={p.loading} onToggle={p.onToggle} />
            <IconButton label="Next sentence" size={44} round onClick={p.onNext}>
              <SkipForward size={20} strokeWidth={1.5} />
            </IconButton>
          </div>
          <div className="relative">
            <IconButton label="More" size={44} round aria-haspopup="menu" aria-expanded={p.menuOpen} onClick={(e) => { e.stopPropagation(); p.onMenuOpenChange(!p.menuOpen); }}>
              <MoreHorizontal size={20} strokeWidth={1.5} />
            </IconButton>
            <Menu open={p.menuOpen} onClose={() => p.onMenuOpenChange(false)} items={buildMenuItems(p, p.extraMenu)} label="Player menu" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      role="region"
      aria-label="Player"
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex h-bar items-center gap-1.5 border-t border-line bg-bg2 px-6 shadow-[0_-8px_30px_-16px_rgba(0,0,0,.4)] animate-rise-slow",
        p.className,
      )}
    >
      <PlayerControls {...p} compact={false} />
    </div>
  );
}
