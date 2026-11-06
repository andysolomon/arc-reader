import type { ReactNode } from "react";
import { SkipBack, SkipForward, MoreHorizontal, Download, Share2, Plus, Mic } from "lucide-react";
import { cn } from "../lib/cn";
import type { Voice } from "../lib/types";
import { fmtTime } from "../lib/format";
import { IconButton } from "./IconButton";
import { VoiceAvatar } from "./VoiceAvatar";
import { PlayPauseIcon } from "./PlayPauseIcon";
import { Scrubber } from "./Scrubber";
import { SpeedChip } from "./SpeedChip";
import { Menu, type MenuItem } from "./Menu";

export interface PlayerState {
  voice: Voice;
  title?: string;
  playing: boolean;
  loading?: boolean;
  speed: number;
  /** 0..1 */
  progress: number;
  ticks: number[];
  /** seconds, already divided by speed */
  elapsed: number;
  remaining: number;
  /** When set, the voice avatar is wrapped by a hint badge (e.g. "local voice") */
  badge?: string;
  /** Short live note beside the time, e.g. "Preparing 12/120" */
  status?: string;
}

export interface PlayerActions {
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (fraction: number) => void;
  onSpeed: (speed: number) => void;
  onVoice: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onAddToLibrary?: () => void;
  onChangeVoice?: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

export type PlayerProps = PlayerState & PlayerActions & { className?: string; compact?: boolean; extraMenu?: MenuItem[] };

export function PlayButton({ playing, loading, onToggle, size = 48 }: { playing: boolean; loading?: boolean; onToggle: () => void; size?: number }) {
  return (
    <IconButton
      label={playing ? "Pause" : "Play"}
      title={`${playing ? "Pause" : "Play"} (Space)`}
      size={size as 48}
      round
      tone="accent"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-busy={loading || undefined}
      data-playing={playing}
      data-loading={loading || undefined}
    >
      <PlayPauseIcon playing={playing} size={Math.round(size / 2)} />
      {loading ? (
        // Generating this sentence: a spinning arc inside the button, no pulse.
        <span aria-hidden className="pointer-events-none absolute inset-[3px] rounded-full border-2 border-transparent border-t-accent-fg animate-spin motion-reduce:animate-none" />
      ) : playing ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-accent shadow-[0_0_0_5px_var(--hl)]" />
      ) : null}
    </IconButton>
  );
}

export function TimeReadout({ elapsed, remaining, status, className }: { elapsed: number; remaining: number; status?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 font-mono text-[12px] text-fg2 tabular-nums", className)} aria-live="off">
      <span aria-label="Elapsed">{fmtTime(elapsed)}</span> <span className="text-fg3">/</span> <span aria-label="Remaining">−{fmtTime(remaining)}</span>
      {status ? <span className="block truncate font-sans text-[10px] text-fg2" aria-live="polite">{status}</span> : null}
    </div>
  );
}

export function buildMenuItems(a: PlayerActions, extra: MenuItem[] = []): MenuItem[] {
  const items: MenuItem[] = [];
  if (a.onDownload) items.push({ id: "download", label: "Download audio", icon: <Download size={16} strokeWidth={1.5} />, onSelect: a.onDownload });
  if (a.onShare) items.push({ id: "share", label: "Share", icon: <Share2 size={16} strokeWidth={1.5} />, onSelect: a.onShare });
  if (a.onAddToLibrary) items.push({ id: "library", label: "Add to library", icon: <Plus size={16} strokeWidth={1.5} />, onSelect: a.onAddToLibrary });
  if (a.onChangeVoice)
    items.push({ id: "voice", label: "Change voice for this document", icon: <Mic size={16} strokeWidth={1.5} />, onSelect: a.onChangeVoice });
  return items.concat(extra);
}

/** The row of controls shared by PlayerPill and PlayerBar. */
export function PlayerControls(p: PlayerProps & { children?: ReactNode }) {
  const items = buildMenuItems(p, p.extraMenu);
  return (
    <>
      <VoiceAvatar voice={p.voice} size={36} interactive onClick={p.onVoice} className="ml-1" />
      <IconButton label="Previous sentence" title="Previous sentence (←)" size={44} round onClick={p.onPrev}>
        <SkipBack size={20} strokeWidth={1.5} />
      </IconButton>
      <PlayButton playing={p.playing} loading={p.loading} onToggle={p.onToggle} />
      <IconButton label="Next sentence" title="Next sentence (→)" size={44} round onClick={p.onNext}>
        <SkipForward size={20} strokeWidth={1.5} />
      </IconButton>
      <SpeedChip speed={p.speed} onChange={p.onSpeed} />
      <Scrubber
        value={p.progress}
        ticks={p.ticks}
        onSeek={p.onSeek}
        valueText={`${fmtTime(p.elapsed)} elapsed, ${fmtTime(p.remaining)} remaining`}
        className={cn(p.compact && "hidden")}
      />
      <TimeReadout elapsed={p.elapsed} remaining={p.remaining} status={p.status} className={cn(p.compact && "hidden sm:block")} />
      <div className="relative">
        <IconButton
          label="More"
          size={44}
          round
          aria-haspopup="menu"
          aria-expanded={p.menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            p.onMenuOpenChange(!p.menuOpen);
          }}
        >
          <MoreHorizontal size={20} strokeWidth={1.5} />
        </IconButton>
        <Menu open={p.menuOpen} onClose={() => p.onMenuOpenChange(false)} items={items} label="Player menu" />
      </div>
      {p.children}
    </>
  );
}
