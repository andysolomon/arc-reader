import { voiceColor } from "./tokens";

/** Service identity stays consistent across themes, voices, and screens. */
export const VOICE_SERVICES = {
  VoiceStudio: { title: "VoiceStudio", hue: 155, description: "Free · on device. Engine presets and voices you clone, design, or add from the Studio gallery. The default voice service." },
  ChatGPT: { title: "ChatGPT", hue: 305, description: "OpenAI’s speech voices. Cloud service; billed per use." },
  Fish: { title: "Fish Audio", hue: 240, description: "Community voices from Fish Audio. Cloud service; billed per use." },
  Browser: { title: "Browser", hue: null, description: "Your device’s built-in speech. Free, works offline; live audio only." },
} as const;

export type VoiceSource = keyof typeof VOICE_SERVICES;

export function voiceSourceForEngine(engine: string): VoiceSource {
  if (engine === "openai") return "ChatGPT";
  if (engine === "fish") return "Fish";
  if (engine === "local") return "Browser";
  return "VoiceStudio";
}

export function voiceServiceColor(source: VoiceSource): string {
  return voiceColor(VOICE_SERVICES[source].hue);
}
