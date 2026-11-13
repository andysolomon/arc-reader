import { MorphIcon } from "morphicons/react";
import { Play, AudioLines } from "lucide";
import type { HTMLAttributes, ReactNode } from "react";
import { VOICE_SERVICES, voiceServiceColor, type VoiceSource } from "@readaloud/tokens";
import { cn } from "../lib/cn";
import type { PortraitVoice } from "../lib/voicePortraits";
import { VoiceAvatar } from "./VoiceAvatar";
import { VoiceServiceName, VoiceSourceBadge } from "./VoiceSourceBadge";

export interface VoiceTilePreview {
  /** Accessible name of the portrait button, e.g. "Preview Bella". */
  label: string;
  /**
   * generating: the speech server is still rendering, nothing can be heard yet.
   * Leave out where the sample plays elsewhere and the portrait is not a toggle.
   */
  state?: "idle" | "generating" | "playing";
  onClick: () => void;
}

export interface VoiceTileProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  voice: PortraitVoice;
  /** Service that renders the voice: colours the name and adds its pill. */
  source?: VoiceSource;
  /** `article` where tiles are the landmarks of a catalogue. */
  as?: "div" | "article";
  /** `h3` where the name belongs in the page outline. */
  nameAs?: "div" | "h3";
  selected?: boolean;
  /** Makes the portrait a button that plays a sample. */
  preview?: VoiceTilePreview;
  /** Top-right controls, stacked: favourite, re-record, delete. */
  corner?: ReactNode;
  /** Details and actions under the service pill. */
  children?: ReactNode;
}

const PORTRAIT = 72;

/** A voice at a glance: portrait ringed in its service colour, name in that colour, service pill. */
export function VoiceTile({ voice, source, as: Tag = "div", nameAs: Name = "div", selected, preview, corner, children, className, style, ...rest }: VoiceTileProps) {
  const state = preview?.state ?? "idle";
  // The Browser voice has no service colour; its ring stays neutral.
  const ring = source && VOICE_SERVICES[source].hue !== null ? voiceServiceColor(source) : "var(--fg2)";
  return (
    <Tag
      className={cn(
        "relative flex min-w-0 flex-col items-center gap-2 rounded-card border px-3 pb-3 pt-4 text-center",
        !selected && "border-transparent",
        className,
      )}
      style={selected ? { borderColor: ring, boxShadow: `inset 0 0 0 1px ${ring}`, ...style } : style}
      {...rest}
    >
      {corner && <div className="absolute right-1 top-1 flex flex-col">{corner}</div>}
      {preview ? (
        <button
          type="button"
          onClick={preview.onClick}
          aria-label={preview.label}
          title={preview.label}
          aria-pressed={preview.state === undefined ? undefined : state !== "idle"}
          aria-busy={state === "generating" || undefined}
          className="group relative shrink-0 rounded-full border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <VoiceAvatar voice={voice} size={PORTRAIT} className="transition-[filter] duration-fast group-hover:brightness-110" />
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border transition-colors duration-fast",
              state === "playing" ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-fg group-hover:bg-bg3",
            )}
          >
            {state === "generating" ? (
              <span className="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none" />
            ) : (
              <MorphIcon icon={state === "playing" ? AudioLines : Play} size={14} strokeWidth={2} reducedMotion="user" style={{ display: "block" }} />
            )}
          </span>
        </button>
      ) : (
        <VoiceAvatar voice={voice} size={PORTRAIT} />
      )}
      <Name className="m-0 max-w-full text-balance text-[16px] font-medium leading-snug [overflow-wrap:anywhere]">
        {source ? <VoiceServiceName source={source}>{voice.name}</VoiceServiceName> : voice.name}
      </Name>
      {source && <span aria-label={`Voice source: ${source}`}><VoiceSourceBadge source={source} /></span>}
      {children}
    </Tag>
  );
}
