import { describe, it, expect } from "vitest";
import { FISH_PRESET_VOICES, LOCAL_VOICE, OPENAI_VOICES, PRESET_VOICES, type Voice } from "../data/voices";
import { NO_GALLERY_FILTERS, NO_VOICE_FILTERS, facetCounts, filterVoices, galleryParams, languageLabel, matchesGallery, voiceLanguage, voiceType } from "./filters";
import type { Archetype } from "./studio";

const cloned: Voice = { id: "p1", name: "Mara", lang: "DE-DE", tags: ["cloned"], hue: 1, engine: "omnivoice", kind: "profile" };
const designed: Voice = { ...cloned, id: "p2", name: "Narrator", lang: "EN-GB", tags: ["designed"] };
const voices = [...OPENAI_VOICES, ...FISH_PRESET_VOICES, cloned, designed, ...PRESET_VOICES, LOCAL_VOICE];

describe("Voices filters", () => {
  it("reads language codes and types from the card metadata", () => {
    expect(voiceLanguage({ lang: "EN-US · Fish Audio" })).toBe("EN-US");
    expect(voiceLanguage({ lang: "MULTI · 31" })).toBe("MULTI");
    expect(voiceLanguage({ lang: "DE-DE" })).toBe("DE-DE");
    expect([voiceType(cloned), voiceType(designed), voiceType(LOCAL_VOICE)]).toEqual(["cloned", "designed", "built-in"]);
    expect(languageLabel("MULTI")).toBe("Multilingual");
    expect(languageLabel("EN-GB")).toBe("English (United Kingdom)");
  });
  it("combines source, language, type and search", () => {
    expect(filterVoices(voices, NO_VOICE_FILTERS)).toHaveLength(voices.length);
    expect(filterVoices(voices, { ...NO_VOICE_FILTERS, source: "ChatGPT" }).map((v) => v.engine)).toEqual(OPENAI_VOICES.map(() => "openai"));
    expect(filterVoices(voices, { ...NO_VOICE_FILTERS, language: "EN-JM" }).map((v) => v.name)).toEqual(["Jamaican English", "Jamaican Patois"]);
    expect(filterVoices(voices, { ...NO_VOICE_FILTERS, type: "designed" })).toEqual([designed]);
    expect(filterVoices(voices, { ...NO_VOICE_FILTERS, query: " podcast " }).map((v) => v.name)).toEqual(["Shimmer", "Verse", "Nova", "Theo"]);
    expect(filterVoices(voices, { ...NO_VOICE_FILTERS, source: "VoiceStudio", query: "podcast" }).map((v) => v.name)).toEqual(["Nova", "Theo"]);
    expect(filterVoices(voices, { ...NO_VOICE_FILTERS, source: "Fish", type: "cloned" })).toEqual([]);
  });
  it("counts facet values in first-seen order", () => {
    expect(facetCounts(["a", "b", "a"], (x) => x)).toEqual([["a", 2], ["b", 1]]);
  });
});

describe("Studio gallery filters", () => {
  const whisper: Archetype = { id: "g", name: "The Calm Guide", use_case: "narration", language: "English", instruct: "female, middle-aged, low pitch, whisper", attrs: { Gender: "female", Age: "middle-aged", Pitch: "low pitch", EnglishAccent: "Auto" }, facets: { gender: "female", age: "middle-aged", pitch: "low pitch", accent: null, whisper: true, lang: "English" } };
  it("sends only the chosen facets to VoiceStudio", () => {
    expect(galleryParams({ ...NO_GALLERY_FILTERS, gender: "male", whisper: "false" })).toEqual([["gender", "male"], ["whisper", "false"]]);
  });
  it("matches favorites locally, including ones saved before facets were stored", () => {
    expect(matchesGallery(whisper, { ...NO_GALLERY_FILTERS, gender: "female", whisper: "true", use_case: "narration" })).toBe(true);
    expect(matchesGallery(whisper, { ...NO_GALLERY_FILTERS, accent: "british accent" })).toBe(false);
    const legacy = { ...whisper, facets: undefined, attrs: { Gender: "male", EnglishAccent: "british accent" }, instruct: "male, british accent" };
    expect(matchesGallery(legacy, { ...NO_GALLERY_FILTERS, gender: "male", accent: "british accent", whisper: "false", lang: "English" })).toBe(true);
    expect(matchesGallery(legacy, { ...NO_GALLERY_FILTERS, pitch: "low pitch" })).toBe(false);
  });
});
