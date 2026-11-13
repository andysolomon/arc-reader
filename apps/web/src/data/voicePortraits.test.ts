import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoiceAvatar, VoiceAvatarImages } from "../../../../packages/ui/src/components/VoiceAvatar";
import { VoicePortrait } from "../../../../packages/ui/src/components/VoicePortrait";
import { VOICE_PORTRAITS, STUDIO_PORTRAITS, voiceAvatarIdentity, voicePortrait } from "../../../../packages/ui/src/lib/voicePortraits";
import { PRESET_VOICES, OPENAI_VOICES, OPENAI_ACCENT_VOICES, FISH_PRESET_VOICES, PHONON_VOICES, LOCAL_VOICE } from "./voices";

const catalog = [...PRESET_VOICES, ...OPENAI_VOICES, ...OPENAI_ACCENT_VOICES, ...FISH_PRESET_VOICES, ...PHONON_VOICES, LOCAL_VOICE];
const artwork = (voice: Parameters<typeof voicePortrait>[0]) => renderToStaticMarkup(createElement(VoicePortrait, { portrait: voicePortrait(voice) }));

describe("voice portraits", () => {
  it("gives every built-in voice an explicit direction and different rendered artwork", () => {
    expect(catalog).toHaveLength(68);
    for (const voice of catalog) expect(VOICE_PORTRAITS[`${voice.engine}:${voice.id}`], voice.name).toBeDefined();
    expect(new Set(catalog.map(artwork)).size).toBe(catalog.length);
    expect(Object.keys(VOICE_PORTRAITS)).toHaveLength(catalog.length);
  });

  it("distinguishes every built-in character by silhouette and accessory, without relying on colors", () => {
    const signatures = catalog.map((voice) => {
      const { character, hair, accessory } = voicePortrait(voice);
      return `${character}:${hair}:${accessory}`;
    });
    expect(new Set(signatures).size).toBe(catalog.length);
    const bella = voicePortrait(PRESET_VOICES[0]);
    const zoey = voicePortrait(PHONON_VOICES[0]);
    expect(zoey.hair).not.toBe(bella.hair);
    expect(zoey.accessory).not.toBe(bella.accessory);
  });

  it("gives featured Studio recipes distinct silhouettes too", () => {
    const signatures = Object.values(STUDIO_PORTRAITS).map(([, hair, accessory]) => `${hair}:${accessory}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("uses a shared generated portrait with the service-colored ring", () => {
    const voice = catalog[0];
    const html = renderToStaticMarkup(createElement(VoiceAvatarImages.Provider, { value: { [voiceAvatarIdentity(voice)]: "/api/avatars/images/test.png" } }, createElement(VoiceAvatar, { voice, size: 36 })));
    expect(html).toContain('src="/api/avatars/images/test.png"');
    expect(html).toContain('border:2px solid oklch');
    expect(html).not.toContain("<svg");
  });

  it("distinguishes the two Novas and preserves identity when voices are renamed or reordered", () => {
    const novas = catalog.filter((voice) => voice.name === "Nova");
    expect(artwork(novas[0])).not.toEqual(artwork(novas[1]));
    for (const voice of [...catalog].reverse()) expect(artwork({ ...voice, name: "Renamed" })).toEqual(artwork(voice));
    const custom = { id: "clone-1", name: "My voice", hue: 100, engine: "omnivoice" };
    expect(artwork({ ...custom, name: "A new name", engine: "voxcpm2" })).toEqual(artwork(custom));
    expect(artwork({ ...custom, id: "clone-2" })).not.toEqual(artwork(custom));
  });

  it("keeps a gallery portrait when its recipe becomes a saved profile", () => {
    const gallery = { id: "librarian", archetype: "librarian", name: "Librarian", description: "A calm, warm reader", hue: 30, engine: "omnivoice" };
    expect(artwork({ ...gallery, id: "profile-123", tags: ["designed"], engine: "voxcpm2" })).toEqual(artwork(gallery));
  });

  it("uses the personality of newly discovered voices and recognizes fantasy characters", () => {
    const custom = { id: "new-voice", name: "New voice", hue: 30, engine: "fish" };
    expect(voicePortrait({ ...custom, tags: ["energetic"] }).expression).toBe("expressive");
    expect(voicePortrait({ ...custom, description: "A soft, gentle narrator" }).expression).toBe("soft");
    expect(voicePortrait({ ...custom, description: "An ancient dragon" }).character).toBe("dragon");
    expect(voicePortrait({ ...custom, description: "A calm female narrator" }).accessory).not.toBe("beard");
  });

  it.each([
    ["feat_01_the_documentarian", "The Documentarian", "male, middle-aged, low pitch, american accent", "male"],
    ["feat_03_the_storyteller", "The Storyteller", "male, elderly, low pitch, british accent", "male"],
    ["feat_06_the_mate", "The Mate", "male, young adult, moderate pitch, australian accent", "male"],
    ["feat_00_the_librarian", "The Librarian", "female, middle-aged, low pitch, british accent", "female"],
    ["feat_02_the_calm_guide", "The Calm Guide", "female, middle-aged, low pitch, whisper", "female"],
    ["feat_04_the_neighbor", "The Neighbor", "female, young adult, moderate pitch, american accent", "female"],
    ["feat_05_the_helpdesk", "The Helpdesk", "female, young adult, moderate pitch, indian accent", "female"],
  ])("honors the actual Studio description for %s before and after saving", (id, name, description, gender) => {
    const gallery = { id, archetype: id, name, description, gender, hue: 155, engine: "omnivoice" };
    const saved = { ...gallery, id: "saved-profile", gender: undefined, tags: ["designed"] };
    const portrait = voicePortrait(saved);
    expect(portrait.presentation).toBe(gender);
    if (gender === "male") {
      expect(["crop", "sweep", "curls", "quiff", "sidepart", "locs", "mohawk"]).toContain(portrait.hair);
      expect(portrait.accessory).not.toBe("earrings");
    } else expect(portrait.accessory).not.toBe("beard");
    expect(artwork(saved)).toEqual(artwork(gallery));
  });

  it("prioritizes explicit metadata, recognizes female as a whole word, and never guesses from a name or pitch", () => {
    const custom = { id: "test", name: "Sarah", hue: 155, engine: "omnivoice" };
    expect(voicePortrait({ ...custom, description: "female, very low pitch" }).presentation).toBe("female");
    expect(voicePortrait({ ...custom, description: "male, high pitch, neutral accent" }).presentation).toBe("male");
    expect(voicePortrait({ ...custom, gender: "male", description: "female" }).presentation).toBe("male");
    expect(voicePortrait({ ...custom, gender: "nonbinary", description: "male" }).presentation).toBe("neutral");
    expect(voicePortrait({ ...custom, gender: "Auto", description: "male" }).presentation).toBe("male");
    expect(voicePortrait({ ...custom, description: "deep, low pitch" }).presentation).toBe("neutral");
    expect(voicePortrait({ ...custom, description: "male and female voices" }).presentation).toBe("neutral");
  });

  it("does not give beards to children, female voices, or voices without gender metadata", () => {
    for (let i = 0; i < 100; i++) {
      const custom = { id: `voice-${i}`, name: "Custom", hue: 155, engine: "omnivoice" };
      for (const description of ["male, child", "male, teenager", "female, middle-aged", ""]) {
        expect(["beard", "stubble"]).not.toContain(voicePortrait({ ...custom, description }).accessory);
      }
      expect(["beard", "stubble"]).not.toContain(voicePortrait({ ...custom, gender: "male", age: "child" }).accessory);
    }
  });

  it("keeps the interactive avatar labeled and the decorative artwork hidden from assistive technology", () => {
    const html = renderToStaticMarkup(createElement(VoiceAvatar, { voice: catalog[0], interactive: true, size: 36 }));
    expect(html).toContain('aria-label="Voice: Bella · VoiceStudio"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width:36px;height:36px');
    expect(html).not.toContain("<img");
  });
});
