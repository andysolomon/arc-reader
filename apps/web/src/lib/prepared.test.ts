import { visualBlock, visualKey } from "./visuals";
import { describe, expect, it } from "vitest";
import { FISH_PRESET_VOICES, JAMAICAN_PATOIS_VOICE_ID, LOCAL_VOICE, OPENAI_VOICES, PRESET_VOICES } from "../data/voices";
import { cacheKey } from "../engine/providers";
import type { DocRecord } from "./db";
import { codeKey } from "./codeBlocks";
import { planReading, preparedVoices, sharedPassages } from "./prepared";

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

  it("counts summary audio and ignores previously cached verbatim code", () => {
    const source = "const answer = 42;";
    const explanation = "This example assigns a fixed number.";
    const document = { ...rec, text: "```js\n" + source + "\n```", codeSummaries: { [codeKey({ text: source, language: "js" })]: explanation } };
    expect(preparedVoices(document, [bella], new Set([key(source)]), "gpt-4o-mini-tts")).toEqual([]);
    expect(preparedVoices(document, [bella], new Set([key(explanation)]), "gpt-4o-mini-tts")[0].fraction).toBe(1);
  });

  it("matches cached image descriptions instead of the caption fallback", () => {
    const visual = { kind: "image" as const, src: "https://example.com/photo.png", alt: "A bird", caption: "" };
    const explanation = "A bird rests on a branch.";
    const document = { ...rec, text: visualBlock(visual), visualDescriptions: { [visualKey(visual)]: explanation } };
    expect(preparedVoices(document, [bella], new Set([key(explanation)]), "gpt-4o-mini-tts")[0].fraction).toBe(1);
    expect(preparedVoices(document, [bella], new Set([key("Image description from the article: A bird")]), "gpt-4o-mini-tts")).toEqual([]);
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

describe("passages shared between documents", () => {
  const notice = "A code example appears here. Its spoken explanation is unavailable, so we’ll skip the code and continue.";
  const chapter = (id: string, body: string): DocRecord => ({ ...rec, id, text: `${body}\n\n${notice}\n\nNote` });
  const first = chapter("one", "The first chapter explains routing in detail.");
  const second = chapter("two", "The second chapter explains caching in detail.");
  const shared = sharedPassages([first, second].map(planReading));

  it("finds passages read word for word by more than one document", () => {
    expect([...shared].sort()).toEqual([notice, "Note"].sort());
  });

  it("doesn't count a sibling's shared audio as preparing this document", () => {
    const keys = new Set([key(notice), key("Note"), key("The first chapter explains routing in detail.")]);
    expect(preparedVoices(second, [bella], keys, "gpt-4o-mini-tts", shared)).toEqual([]);
    expect(preparedVoices(first, [bella], keys, "gpt-4o-mini-tts", shared)[0].fraction).toBe(1);
    // Without the shared set, the boilerplate alone would read as partly prepared.
    expect(preparedVoices(second, [bella], keys, "gpt-4o-mini-tts")[0].fraction).toBeGreaterThan(0);
  });

  it("measures a document made only of shared passages by all of them", () => {
    const copy = { ...first, id: "copy" };
    const all = sharedPassages([first, copy].map(planReading));
    const keys = new Set(planReading(first).original.passages.map((passage) => key(passage.text)));
    expect(preparedVoices(copy, [bella], keys, "gpt-4o-mini-tts", all)[0].fraction).toBe(1);
  });
});
