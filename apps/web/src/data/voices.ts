import type { Voice } from "@readaloud/ui";

export const VOICES: Voice[] = [
  { id: "ava", name: "Ava", lang: "EN-US", tags: ["warm", "narrator"], hue: 30 },
  { id: "noah", name: "Noah", lang: "EN-GB", tags: ["crisp", "documentary"], hue: 215 },
  { id: "mara", name: "Mara", lang: "DE-DE", tags: ["calm", "soft"], hue: 150 },
  { id: "leo", name: "Leo", lang: "ES-ES", tags: ["bright", "energetic"], hue: 55 },
  { id: "ines", name: "Inès", lang: "FR-FR", tags: ["warm", "clear"], hue: 330 },
  { id: "kenji", name: "Kenji", lang: "JA-JP", tags: ["measured", "narrator"], hue: 265 },
  { id: "sol", name: "Sol", lang: "PT-BR", tags: ["smooth", "podcast"], hue: 100 },
  { id: "piper", name: "Piper", lang: "EN-US · local", tags: ["offline", "neutral"], hue: null },
];

export const LOCAL_VOICE_ID = "piper";

export function getVoice(id: string | null | undefined): Voice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

/** BCP-47 tag for the Web Speech fallback. */
export function voiceLang(v: Voice): string {
  const m = v.lang.match(/^([A-Z]{2})-([A-Z]{2})/);
  return m ? `${m[1].toLowerCase()}-${m[2]}` : "en-US";
}
