import { voiceSource, type Voice } from "../data/voices";
import type { Archetype } from "./studio";

/* Voices page: the list is small, so filtering happens in the browser. */

export type VoiceType = "built-in" | "cloned" | "designed";
export interface VoiceFilters { query: string; source: string; language: string; type: string }
export const NO_VOICE_FILTERS: VoiceFilters = { query: "", source: "", language: "", type: "" };

/** "EN-US · Fish Audio" → "EN-US"; "MULTI · 31" → "MULTI". */
export const voiceLanguage = (voice: Pick<Voice, "lang">) => voice.lang.split("·")[0].trim();

export function voiceType(voice: Pick<Voice, "kind" | "tags">): VoiceType {
  if (voice.kind !== "profile") return "built-in";
  return voice.tags.includes("designed") ? "designed" : "cloned";
}

export function languageLabel(code: string): string {
  if (code === "MULTI") return "Multilingual";
  const [lang, region] = code.split("-");
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(lang.toLowerCase());
    const place = region && new Intl.DisplayNames(["en"], { type: "region" }).of(region);
    return name && name.toLowerCase() !== lang.toLowerCase() ? (place ? `${name} (${place})` : name) : code;
  } catch {
    return code;
  }
}

export function filterVoices<V extends Voice>(voices: V[], f: VoiceFilters): V[] {
  const search = f.query.trim().toLowerCase();
  return voices.filter((v) =>
    (!f.source || voiceSource(v) === f.source)
    && (!f.language || voiceLanguage(v) === f.language)
    && (!f.type || voiceType(v) === f.type)
    && (!search || [v.name, v.lang, voiceSource(v), ...v.tags].join(" ").toLowerCase().includes(search)));
}

/** Distinct values with counts, in first-seen order. */
export function facetCounts<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts];
}

/* Studio gallery: VoiceStudio filters the catalog by exact facet value. */

export interface GalleryFilters { use_case: string; lang: string; gender: string; age: string; pitch: string; accent: string; whisper: string }
export const NO_GALLERY_FILTERS: GalleryFilters = { use_case: "", lang: "", gender: "", age: "", pitch: "", accent: "", whisper: "" };

const opts = (...values: string[]) => values.map((value) => [value, value[0].toUpperCase() + value.slice(1)] as const);
export const GALLERY_FACETS: { key: keyof GalleryFilters; label: string; any: string; options: readonly (readonly [string, string])[] }[] = [
  { key: "use_case", label: "Category", any: "All categories", options: [["narration", "Narration & story"], ["conversational", "Conversational"], ["characters", "Characters & animation"], ["social", "Social media"], ["entertainment", "Entertainment & TV"], ["advertisement", "Advertisement"], ["informative", "Informative & educational"]] },
  { key: "lang", label: "Language", any: "All languages", options: opts("English", "Chinese", "French", "German", "Hindi", "Italian", "Japanese", "Korean", "Portuguese", "Russian", "Spanish") },
  { key: "gender", label: "Gender", any: "Any gender", options: opts("female", "male") },
  { key: "age", label: "Age", any: "Any age", options: opts("child", "teenager", "young adult", "middle-aged", "elderly") },
  { key: "pitch", label: "Pitch", any: "Any pitch", options: opts("very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch").map(([v, l]) => [v, l.replace(" pitch", "")] as const) },
  { key: "accent", label: "Accent", any: "Any accent", options: ["american", "australian", "british", "canadian", "chinese", "indian", "japanese", "korean", "portuguese", "russian"].map((a) => [`${a} accent`, a[0].toUpperCase() + a.slice(1)] as const) },
  { key: "whisper", label: "Delivery", any: "Any delivery", options: [["false", "Spoken"], ["true", "Whisper"]] },
];

export const activeFilterCount = (f: object) => Object.values(f).filter(Boolean).length;

export function galleryParams(f: GalleryFilters): [string, string][] {
  return Object.entries(f).filter(([, value]) => value);
}

/** Favorites are stored locally, so apply the same facets client-side. Older favorites lack `facets`. */
export function matchesGallery(voice: Archetype, f: GalleryFilters): boolean {
  const facets = voice.facets ?? {};
  const value: Record<keyof GalleryFilters, string> = {
    use_case: voice.use_case,
    lang: facets.lang ?? voice.language,
    gender: facets.gender ?? voice.attrs?.Gender ?? "",
    age: facets.age ?? voice.attrs?.Age ?? "",
    pitch: facets.pitch ?? voice.attrs?.Pitch ?? "",
    accent: facets.accent ?? voice.attrs?.EnglishAccent ?? "",
    whisper: String(facets.whisper ?? /whisper/i.test(voice.instruct)),
  };
  return (Object.keys(f) as (keyof GalleryFilters)[]).every((key) => !f[key] || value[key] === f[key]);
}
