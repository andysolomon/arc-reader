import { createContext, useContext, useState, forwardRef, type ButtonHTMLAttributes } from "react";
import { VOICE_SERVICES, voiceSourceForEngine } from "@readaloud/tokens";
import { cn } from "../lib/cn";
import { voiceAvatarIdentity, voicePortrait, type PortraitVoice } from "../lib/voicePortraits";
import { VoicePortrait } from "./VoicePortrait";

/** Optional server-generated portraits, shared across every avatar surface. */
export const VoiceAvatarImages = createContext<Record<string, string>>({});

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
  const images = useContext(VoiceAvatarImages);
  const url = images[voiceAvatarIdentity(voice)];
  const [failedUrl, setFailedUrl] = useState<string>();
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
  const artwork = url && url !== failedUrl ? (
    <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async"
      onError={() => setFailedUrl(url)} style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%", border: `${Math.max(2, size * 0.055)}px solid ${portrait.background}`, boxSizing: "border-box" }} />
  ) : <VoicePortrait portrait={portrait} />;
  if (interactive) {
    return (
      <button ref={ref} type="button" aria-label={label} title={label} {...common} {...rest}>
        {artwork}
      </button>
    );
  }
  return (
    <span aria-hidden {...common}>
      {artwork}
    </span>
  );
});
