import type { Voice as UiVoice } from "@readaloud/ui";
import { hash } from "../lib/hash";
import { LOCAL_ENGINE } from "../engine/types";
import { VOICE_SERVICES, voiceSourceForEngine, type VoiceSource } from "@readaloud/tokens";

export interface Voice extends UiVoice {
  /** Engine that renders this voice; "local" for the browser voice */
  engine: string;
  /** preset: engine built-in · profile: cloned/designed on the server · local: browser speech */
  kind: "preset" | "profile" | "local";
  /** Studio gallery recipe this saved voice was added from; such voices can be sent back to the gallery. */
  archetype?: string;
}

export function voiceSource(voice: Pick<Voice, "engine">): VoiceSource {
  return voiceSourceForEngine(voice.engine);
}

/** What each `voiceSource` label means: which service renders the voice. */
export const SOURCE_INFO: Record<string, { title: string; description: string }> = VOICE_SERVICES;

export const LOCAL_VOICE_ID = "local";
export const JAMAICAN_PATOIS_VOICE_ID = "fish:0724e14ccf884007a641908722575fdf";

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

const READ_AS_WRITTEN = "Read the text exactly as written: change pronunciation, rhythm and intonation only, never add or swap words.";

/**
 * Sent with every gpt-4o-mini-tts request. Each passage is a separate generation,
 * so the model is told to hold one delivery rather than re-interpret the mood per request.
 */
export const STEADY_NARRATION = `Narrate as one continuous reading: keep the same calm tone, pace, pitch and volume from the first word to the last, as if this were the next part of a longer recording. ${READ_AS_WRITTEN}`;

/**
 * Regional accent voices: an OpenAI voice steered by gpt-4o-mini-tts `instructions`.
 * Ids are ours (`<base>~<accent>`), so each accent gets its own cache entries.
 */
export const OPENAI_ACCENTS: Record<string, { voice: string; instructions: string }> = {
  "coral~georgia": {
    voice: "coral",
    instructions: `Speak with a warm Georgia Southern accent. Use a gentle drawl that stretches stressed vowels, say "I" closer to "ah", glide vowels in words like "day" and "ride", and keep a relaxed, unhurried, friendly pace with a soft melodic rise and fall. ${READ_AS_WRITTEN}`,
  },
};

const accent = (id: string, name: string, tags: string[]): Voice => ({ id, name, lang: "EN-US · cloud", tags, hue: hueFor("openai:" + id), engine: "openai", kind: "preset" });

export const OPENAI_ACCENT_VOICES: Voice[] = [
  accent("coral~georgia", "Savannah", ["Georgia", "Southern"]),
];

// Fish's documented example voice; stays available if catalogue discovery fails.
export const FISH_DEFAULT_VOICE: Voice = {
  id: "fish:933563129e564b19a115bedd57b7406a", name: "Sarah", lang: "EN-US · Fish Audio",
  tags: ["narrator"], hue: hueFor("fish:sarah"), engine: "fish", kind: "preset",
};

/** Curated voices stay selectable even outside the current Fish catalogue page. */
export const FISH_PRESET_VOICES: Voice[] = [
  FISH_DEFAULT_VOICE,
  {
    // https://fish.audio/m/d7988a7138db47cc8a4876a36625dff6/
    id: "fish:d7988a7138db47cc8a4876a36625dff6", name: "Jamaican English", lang: "EN-JM · Fish Audio",
    tags: ["Jamaican accent"], hue: hueFor("fish:d7988a7138db47cc8a4876a36625dff6"), engine: "fish", kind: "preset",
  },
  {
    // https://fish.audio/m/0724e14ccf884007a641908722575fdf/
    id: JAMAICAN_PATOIS_VOICE_ID, name: "Jamaican Patois", lang: "EN-JM · Fish Audio",
    tags: ["rewrites to Patois"], hue: hueFor(JAMAICAN_PATOIS_VOICE_ID), engine: "fish", kind: "preset",
  },
];

export const PHONON_PREFIX = "phonon:";
/** A Phonon voice. The id is `phonon:<name>`; the name is what the server accepts as `voice`. */
export const phononVoice = (name: string, lang = "EN", tags: string[] = []): Voice => ({
  id: PHONON_PREFIX + name, name, lang, tags, hue: hueFor(PHONON_PREFIX + name), engine: "phonon", kind: "preset",
});
const phononGroup = (lang: string, tags: string[], names: string[]) => names.map((name) => phononVoice(name, lang, tags));

/**
 * Phonon's English voices, as published in gradium/phonon-voices and listed by its
 * server. Shown before the server answers; its unnamed `default` entry is left out.
 */
export const PHONON_VOICES: Voice[] = [
  ...phononGroup("EN-US", ["female", "American"], ["Zoey", "Juniper", "Everly", "Harper", "Hadley", "Delia"]),
  ...phononGroup("EN-US", ["male", "American"], ["Easton", "Micah", "Trevor", "Russell", "Preston", "Miles"]),
  ...phononGroup("EN-GB", ["female", "British"], ["Maeve", "Freya", "Pippa", "Elodie-Rose", "Imogen", "Lottie", "Bryony"]),
  ...phononGroup("EN-GB", ["male", "British"], ["Alfie", "Hugh", "Edwin", "Spencer", "Toby", "Teddy"]),
  ...phononGroup("EN", ["character"], [
    "Azgorath", "Captain Silas Blackwater", "Fairy Godmother", "Fennick the Young Elf", "Grub the Ogre", "Master Aldric",
    "Morwenna of the Deep", "Old Mortlake", "Sir Bramwell", "The Snow Queen", "The Thing Under the Stairs", "Vyrmathrax the Ancient",
  ]),
];

export const LOCAL_VOICE: Voice = { id: LOCAL_VOICE_ID, name: "Browser voice", lang: "EN-US · local", tags: ["offline", "neutral"], hue: null, engine: LOCAL_ENGINE, kind: "local" };

/** The list shown before (or without) a speech server. */
export const DEFAULT_VOICES: Voice[] = [...PRESET_VOICES, LOCAL_VOICE];

/** The default voice: Phonon's Zoey. */
export const DEFAULT_VOICE_ID = PHONON_PREFIX + "Zoey";

/** The default in a deployment without Phonon: KittenTTS's Bella on VoiceStudio. */
export const FALLBACK_VOICE_ID = "expr-voice-2-f";

/** BCP-47 tag for the Web Speech fallback. */
export function voiceLang(v: Pick<Voice, "lang">): string {
  const m = v.lang.match(/^([A-Z]{2})-([A-Z]{2})/);
  return m ? `${m[1].toLowerCase()}-${m[2]}` : "en-US";
}
