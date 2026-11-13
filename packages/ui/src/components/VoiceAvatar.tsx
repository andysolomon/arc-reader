import { forwardRef, type ButtonHTMLAttributes } from "react";
import { VOICE_SERVICES, voiceSourceForEngine } from "@readaloud/tokens";
import { cn } from "../lib/cn";
import { voicePortrait, type PortraitVoice } from "../lib/voicePortraits";
import { VoicePortrait } from "./VoicePortrait";

export interface VoiceAvatarProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  voice: PortraitVoice;
  size?: number;
  /** Render as a button (opens Voices) */
  interactive?: boolean;
}

export const VoiceAvatar = forwardRef<HTMLButtonElement, VoiceAvatarProps>(function VoiceAvatar(
  { voice, size = 24, interactive, className, style, ...rest },
  ref,
) {
  const source = voice.engine ? voiceSourceForEngine(voice.engine) : null;
  const portrait = voicePortrait(voice);
  const label = `Voice: ${voice.name}${source ? ` · ${VOICE_SERVICES[source].title}` : ""}`;
  const common = {
    className: cn(
      "inline-grid shrink-0 place-items-center overflow-hidden rounded-full border-0 p-0 leading-none select-none",
      interactive && "hover:brightness-110 transition-[filter] duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      className,
    ),
    "data-voice-source": source ?? undefined,
    style: { width: size, height: size, background: portrait.background, ...style },
  };
  if (interactive) {
    return (
      <button ref={ref} type="button" aria-label={label} title={label} {...common} {...rest}>
        <VoicePortrait portrait={portrait} />
      </button>
    );
  }
  return (
    <span aria-hidden {...common}>
      <VoicePortrait portrait={portrait} />
    </span>
  );
});
