import { forwardRef, type ButtonHTMLAttributes } from "react";
import { voiceColor } from "@readaloud/tokens";
import { cn } from "../lib/cn";
import type { Voice } from "../lib/types";

export interface VoiceAvatarProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  voice: Pick<Voice, "name" | "hue">;
  size?: number;
  /** Render as a button (opens Voices) */
  interactive?: boolean;
}

export const VoiceAvatar = forwardRef<HTMLButtonElement, VoiceAvatarProps>(function VoiceAvatar(
  { voice, size = 24, interactive, className, style, ...rest },
  ref,
) {
  const local = voice.hue === null;
  const common = {
    className: cn(
      "inline-grid shrink-0 place-items-center rounded-full border-0 font-semibold leading-none select-none",
      local ? "text-fg" : "text-[#1a1410]",
      interactive && "hover:brightness-110 transition-[filter] duration-fast",
      className,
    ),
    style: { width: size, height: size, fontSize: Math.round(size * 0.42), background: voiceColor(voice.hue), ...style },
  };
  if (interactive) {
    return (
      <button ref={ref} type="button" aria-label={`Voice: ${voice.name}`} title={voice.name} {...common} {...rest}>
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
