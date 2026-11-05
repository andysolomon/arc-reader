import { forwardRef, type ButtonHTMLAttributes } from "react";
import { VOICE_SERVICES, voiceColor, voiceServiceColor, voiceSourceForEngine } from "@readaloud/tokens";
import { cn } from "../lib/cn";
import type { Voice } from "../lib/types";

export interface VoiceAvatarProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  voice: Pick<Voice, "name" | "hue" | "engine">;
  size?: number;
  /** Render as a button (opens Voices) */
  interactive?: boolean;
}

export const VoiceAvatar = forwardRef<HTMLButtonElement, VoiceAvatarProps>(function VoiceAvatar(
  { voice, size = 24, interactive, className, style, ...rest },
  ref,
) {
  const source = voice.engine ? voiceSourceForEngine(voice.engine) : null;
  const local = source ? source === "Browser" : voice.hue === null;
  const label = `Voice: ${voice.name}${source ? ` · ${VOICE_SERVICES[source].title}` : ""}`;
  const common = {
    className: cn(
      "inline-grid shrink-0 place-items-center rounded-full border-0 font-semibold leading-none select-none",
      local ? "text-fg" : "text-[#1a1410]",
      interactive && "hover:brightness-110 transition-[filter] duration-fast",
      className,
    ),
    "data-voice-source": source ?? undefined,
    style: { width: size, height: size, fontSize: Math.round(size * 0.42), background: source ? voiceServiceColor(source) : voiceColor(voice.hue), ...style },
  };
  if (interactive) {
    return (
      <button ref={ref} type="button" aria-label={label} title={label} {...common} {...rest}>
        {voice.name[0]}
      </button>
    );
  }
  return (
    <span aria-hidden {...common}>
      {voice.name[0]}
    </span>
  );
});
