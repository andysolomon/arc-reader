import { voiceColor } from "./tokens";

/**
 * Service identity stays consistent across themes, voices, and screens.
 * `summary` is what choosing the service means for a reader, short enough for a list heading.
 */
export const VOICE_SERVICES = {
  VoiceStudio: { title: "VoiceStudio", hue: 155, summary: "Free", description: "Free · on device. Engine presets and voices you clone, design, or add from the Studio gallery. The default voice service." },
  Phonon: { title: "Phonon", hue: 200, summary: "Free · keeps up with reading", description: "Free · on this server. Fast English voices from Gradium’s Phonon. They run on the CPU, so they keep up with reading." },
  ChatGPT: { title: "ChatGPT", hue: 305, summary: "Billed per use", description: "OpenAI’s speech voices. Cloud service; billed per use." },
  Fish: { title: "Fish Audio", hue: 30, summary: "Billed per use", description: "Community voices from Fish Audio. Cloud service; billed per use." },
  Browser: { title: "Browser", hue: null, summary: "Free · works offline", description: "Your device’s built-in speech. Free, works offline; live audio only." },
} as const;

export type VoiceSource = keyof typeof VOICE_SERVICES;

export function voiceSourceForEngine(engine: string): VoiceSource {
  if (engine === "phonon") return "Phonon";
  if (engine === "openai") return "ChatGPT";
  if (engine === "fish") return "Fish";
  if (engine === "local") return "Browser";
  return "VoiceStudio";
}

export function voiceServiceColor(source: VoiceSource): string {
  return voiceColor(VOICE_SERVICES[source].hue);
}

/** Service colour as readable text on --bg/--bg2/--bg3; the Browser voice stays neutral. */
export function voiceServiceTextColor(source: VoiceSource): string {
  const hue = VOICE_SERVICES[source].hue;
  return hue === null ? "var(--fg2)" : `oklch(var(--voice-text-l, 0.82) 0.11 ${hue})`;
}
