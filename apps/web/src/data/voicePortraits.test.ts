import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoiceAvatar } from "../../../../packages/ui/src/components/VoiceAvatar";
import { VoicePortrait } from "../../../../packages/ui/src/components/VoicePortrait";
import { VOICE_PORTRAITS, voicePortrait } from "../../../../packages/ui/src/lib/voicePortraits";
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

  it("keeps the interactive avatar labeled and the decorative artwork hidden from assistive technology", () => {
    const html = renderToStaticMarkup(createElement(VoiceAvatar, { voice: catalog[0], interactive: true, size: 36 }));
    expect(html).toContain('aria-label="Voice: Bella · VoiceStudio"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width:36px;height:36px');
    expect(html).not.toContain("<img");
  });
});
