import { describe, expect, it } from "vitest";
import { FISH_PRESET_VOICES, JAMAICAN_PATOIS_VOICE_ID, LOCAL_VOICE, OPENAI_VOICES, PRESET_VOICES } from "../data/voices";
import { cacheKey } from "../engine/providers";
import type { DocRecord } from "./db";
import { preparedVoices } from "./prepared";

const rec: DocRecord = { id: "d", title: "Document", text: "One two. Three four.\n\nFive six.", source: "paste", domain: "Text", voice: null, chars: 32, createdAt: 0, updatedAt: 0 };
const [bella, jasper] = PRESET_VOICES;
const key = (text: string, voice = bella, openaiModel = "gpt-4o-mini-tts") => cacheKey({ text, voice: voice.id, engine: voice.engine, openaiModel });

describe("prepared audio coverage", () => {
  it("counts actual cached text per voice, including older sentence clips, without double counting", () => {
    const keys = new Set([key("One two. Three four."), key("One two."), key("Five six.", jasper)]);
    expect(preparedVoices(rec, [bella, jasper, LOCAL_VOICE], keys, "gpt-4o-mini-tts")).toEqual([
      { voiceId: bella.id, name: bella.name, engine: bella.engine, fraction: 2 / 3 },
      { voiceId: jasper.id, name: jasper.name, engine: jasper.engine, fraction: 1 / 3 },
    ]);
    expect(preparedVoices(rec, [bella], new Set([key("One two.")]), "gpt-4o-mini-tts")[0].fraction).toBe(1 / 3);
    expect(preparedVoices(rec, [bella], new Set(), "gpt-4o-mini-tts")).toEqual([]);
    expect(preparedVoices({ ...rec, text: "Different text." }, [bella], keys, "gpt-4o-mini-tts")).toEqual([]);
  });

  it("matches the engine and OpenAI model used for playback", () => {
    const voice = OPENAI_VOICES[0];
    const keys = new Set([key("One two. Three four.", voice, "tts-1")]);
    expect(preparedVoices(rec, [voice], keys, "gpt-4o-mini-tts")).toEqual([]);
    expect(preparedVoices(rec, [voice], keys, "tts-1")[0].fraction).toBe(2 / 3);
    expect(preparedVoices(rec, [{ ...voice, engine: "other" }], keys, "tts-1")).toEqual([]);
  });

  it("uses the Patois adaptation only while it matches the original", () => {
    const voice = FISH_PRESET_VOICES.find((v) => v.id === JAMAICAN_PATOIS_VOICE_ID)!;
    const keys = new Set([key("Wah gwaan.", voice)]);
    const adapted = { ...rec, patois: { sourceText: rec.text, text: "Wah gwaan.", version: 1 } };
    expect(preparedVoices(adapted, [voice], keys, "gpt-4o-mini-tts")[0].fraction).toBe(1);
    expect(preparedVoices({ ...adapted, text: "Changed." }, [voice], keys, "gpt-4o-mini-tts")).toEqual([]);
    expect(preparedVoices(rec, [voice], keys, "gpt-4o-mini-tts")).toEqual([]);
  });
});
