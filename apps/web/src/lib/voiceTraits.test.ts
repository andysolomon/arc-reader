import { describe, expect, it } from "vitest";
import { FISH_PRESET_VOICES, LOCAL_VOICE, OPENAI_ACCENT_VOICES, PHONON_VOICES, PRESET_VOICES, type Voice } from "../data/voices";
import { voiceTraits } from "./voiceTraits";

const named = (name: string) => [...PRESET_VOICES, ...PHONON_VOICES, ...OPENAI_ACCENT_VOICES, ...FISH_PRESET_VOICES].find((v) => v.name === name)!;

describe("voiceTraits", () => {
  it("describes built-in voices by their tags", () => {
    expect(voiceTraits(named("Bella"))).toBe("Warm · narrator");
    expect(voiceTraits(named("Hugh"))).toBe("Male · British");
    expect(voiceTraits(named("Savannah"))).toBe("Georgia · Southern");
    expect(voiceTraits(named("Jamaican Patois"))).toBe("Rewrites to Patois");
    expect(voiceTraits(LOCAL_VOICE)).toBe("Offline · neutral");
  });
  it("tells character voices apart by the kind of character", () => {
    expect(voiceTraits(named("Master Aldric"))).toBe("Character · wizard");
    expect(voiceTraits(named("Vyrmathrax the Ancient"))).toBe("Character · dragon");
    const characters = PHONON_VOICES.filter((v) => v.tags.includes("character")).map(voiceTraits);
    expect(new Set(characters).size).toBe(characters.length);
  });
  it("adds a custom voice's direction and a language other than English", () => {
    const custom: Voice = { id: "p1", name: "Mara", lang: "DE-DE", tags: ["designed"], description: " A calm, gentle narrator ", hue: 1, engine: "omnivoice", kind: "profile" };
    expect(voiceTraits(custom)).toBe("Designed · A calm, gentle narrator · German (Germany)");
    expect(voiceTraits({ ...custom, lang: "Auto", tags: ["cloned"], description: undefined })).toBe("Cloned");
    expect(voiceTraits({ ...custom, lang: "", tags: [], description: undefined })).toBe("");
  });
});
