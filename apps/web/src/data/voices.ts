import type { Voice as UiVoice } from "@readaloud/ui";
import { hash } from "../lib/hash";
import { LOCAL_ENGINE } from "../engine/types";

export interface Voice extends UiVoice {
  /** Engine that renders this voice; "local" for the browser voice */
  engine: string;
  /** preset: engine built-in · profile: cloned/designed on the server · local: browser speech */
  kind: "preset" | "profile" | "local";
}

export const LOCAL_VOICE_ID = "local";

/** Stable avatar hue from the id, so a voice keeps its colour across reloads and devices. */
export function hueFor(id: string): number {
  return parseInt(hash(id).slice(0, 4), 16) % 360;
}

const kitten = (id: string, name: string, tags: string[]): Voice => ({ id, name, lang: "EN-US", tags, hue: hueFor(id), engine: "kittentts", kind: "preset" });
const supertonic = (id: string, name: string, tags: string[]): Voice => ({ id, name, lang: "MULTI · 31", tags, hue: hueFor(id), engine: "supertonic3", kind: "preset" });

/**
 * Engine preset voices. Ids are what the engines accept as `voice`; names are ours.
 * KittenTTS: four male/female pairs (expr-voice-2-f is the engine default).
 * Supertonic-3: the seven presets its guide surfaces.
 */
export const PRESET_VOICES: Voice[] = [
  kitten("expr-voice-2-f", "Bella", ["warm", "narrator"]),
  kitten("expr-voice-2-m", "Jasper", ["calm", "narrator"]),
  kitten("expr-voice-3-f", "Luna", ["bright", "clear"]),
  kitten("expr-voice-3-m", "Felix", ["crisp", "documentary"]),
  kitten("expr-voice-4-f", "Mira", ["soft", "measured"]),
  kitten("expr-voice-4-m", "Oscar", ["deep", "steady"]),
  kitten("expr-voice-5-f", "Nova", ["energetic", "podcast"]),
  kitten("expr-voice-5-m", "Theo", ["smooth", "podcast"]),
  supertonic("M1", "Marco", ["multilingual", "default"]),
  supertonic("F3", "Elena", ["multilingual", "warm"]),
  supertonic("M3", "Diego", ["multilingual", "crisp"]),
  supertonic("F4", "Sofia", ["multilingual", "bright"]),
  supertonic("M4", "Hugo", ["multilingual", "measured"]),
  supertonic("F5", "Yuki", ["multilingual", "soft"]),
  supertonic("M5", "Kai", ["multilingual", "energetic"]),
];

const openai = (id: string, name: string, tags: string[]): Voice => ({ id, name, lang: "MULTI · cloud", tags, hue: hueFor("openai:" + id), engine: "openai", kind: "preset" });

/** The ChatGPT voices, served by OpenAI's speech endpoint. Ids are OpenAI's voice names. */
export const OPENAI_VOICES: Voice[] = [
  openai("alloy", "Alloy", ["neutral", "clear"]),
  openai("ash", "Ash", ["warm", "steady"]),
  openai("ballad", "Ballad", ["soft", "expressive"]),
  openai("coral", "Coral", ["bright", "friendly"]),
  openai("echo", "Echo", ["deep", "measured"]),
  openai("fable", "Fable", ["storyteller", "narrator"]),
  openai("nova", "Nova", ["energetic", "clear"]),
  openai("onyx", "Onyx", ["deep", "narrator"]),
  openai("sage", "Sage", ["calm", "documentary"]),
  openai("shimmer", "Shimmer", ["light", "podcast"]),
  openai("verse", "Verse", ["expressive", "podcast"]),
];

// Fish's documented example voice; stays available if catalogue discovery fails.
export const FISH_DEFAULT_VOICE: Voice = {
  id: "fish:933563129e564b19a115bedd57b7406a", name: "Sarah", lang: "EN-US · Fish Audio",
  tags: ["Fish Audio", "narrator"], hue: hueFor("fish:sarah"), engine: "fish", kind: "preset",
};

export const LOCAL_VOICE: Voice = { id: LOCAL_VOICE_ID, name: "Browser voice", lang: "EN-US · local", tags: ["offline", "neutral"], hue: null, engine: LOCAL_ENGINE, kind: "local" };

/** The list shown before (or without) a speech server. */
export const DEFAULT_VOICES: Voice[] = [...PRESET_VOICES, LOCAL_VOICE];

export const DEFAULT_VOICE_ID = "expr-voice-2-f";

/** BCP-47 tag for the Web Speech fallback. */
export function voiceLang(v: Pick<Voice, "lang">): string {
  const m = v.lang.match(/^([A-Z]{2})-([A-Z]{2})/);
  return m ? `${m[1].toLowerCase()}-${m[2]}` : "en-US";
}
