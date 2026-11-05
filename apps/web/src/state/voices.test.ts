import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFishVoices, fetchServerVoices } from "../engine/providers";
import { getVoice, useVoices } from "./voices";
import { DEFAULT_VOICE_ID, LOCAL_VOICE, voiceSource } from "../data/voices";

vi.mock("../engine/providers", async (original) => ({
  ...await original<typeof import("../engine/providers")>(),
  fetchFishVoices: vi.fn(), fetchServerVoices: vi.fn(),
}));
const profiles: { id: string; name: string; kind: string; language: string; personality?: string | null }[] = [];
const studioFetch = vi.fn(async () => new Response("{}"));
vi.mock("../lib/studio", async (original) => ({
  ...await original<typeof import("../lib/studio")>(),
  studioJson: async (path: string) => path === "/profiles" ? profiles : { tts: { active: "omnivoice" } },
  studioFetch: (...args: unknown[]) => studioFetch(...(args as [])),
}));
const initial = useVoices.getState();
beforeEach(() => { vi.resetAllMocks(); profiles.length = 0; studioFetch.mockResolvedValue(new Response("{}")); useVoices.setState(initial, true); });
const fish = [{ _id: "narrator", title: "Narrator", languages: ["en"] }];
const local = { voices: [{ id: "profile", name: "My voice", type: "profile" }], engines: [{ id: "kittentts", available: true }] };

describe("voice providers", () => {
  it("keeps both Jamaican voices available before discovery, after failure, and without duplicate catalogue entries", async () => {
    const englishId = "fish:d7988a7138db47cc8a4876a36625dff6";
    const patoisId = "fish:0724e14ccf884007a641908722575fdf";
    const checkVoices = () => {
      for (const [id, name] of [[englishId, "Jamaican English"], [patoisId, "Jamaican Patois"]]) {
        expect(useVoices.getState().voices.filter((v) => v.id === id)).toHaveLength(1);
        expect(getVoice(id)).toMatchObject({ name, engine: "fish", kind: "preset" });
      }
    };
    checkVoices();
    vi.mocked(fetchFishVoices).mockRejectedValueOnce(new Error("Catalogue unavailable"));
    await useVoices.getState().loadFish();
    checkVoices();
    vi.mocked(fetchFishVoices).mockResolvedValueOnce([
      ...fish,
      { _id: englishId.slice(5), title: "Jamaican Accent Male", languages: ["en"] },
      { _id: patoisId.slice(5), title: "Jamaican Patois Male", languages: ["en"] },
    ]);
    await useVoices.getState().loadFish();
    checkVoices();
    expect(getVoice("fish:narrator").name).toBe("Narrator");
    vi.mocked(fetchFishVoices).mockResolvedValueOnce([]);
    await useVoices.getState().loadFish();
    checkVoices();
  });

  it.each([true, false])("preserves both catalogues when Fish finishes first: %s", async (fishFirst) => {
    let finishFish!: (value: typeof fish) => void;
    let finishLocal!: (value: typeof local) => void;
    vi.mocked(fetchFishVoices).mockReturnValue(new Promise((resolve) => { finishFish = resolve; }));
    vi.mocked(fetchServerVoices).mockReturnValue(new Promise((resolve) => { finishLocal = resolve; }));
    const loading = useVoices.getState().load();
    if (fishFirst) finishFish(fish); else finishLocal(local);
    await Promise.resolve();
    if (fishFirst) finishLocal(local); else finishFish(fish);
    await loading;
    const { voices, loaded } = useVoices.getState();
    expect(loaded).toBe(true);
    expect(voices.map((v) => v.id)).toEqual(expect.arrayContaining(["fish:narrator", "profile", "nova", "local"]));
    expect(getVoice("fish:narrator")).toMatchObject({ name: "Narrator", engine: "fish", kind: "preset" });
  });
  it("labels a cloned voice's automatic language as Auto, not as a country code", async () => {
    vi.mocked(fetchServerVoices).mockResolvedValue({ voices: [
      { id: "auto-clone", name: "Me", type: "profile", language: "Auto" },
      { id: "en-clone", name: "Narrator", type: "profile", language: "en-GB" },
    ], engines: [] });
    await useVoices.getState().loadServer();
    expect(getVoice("auto-clone").lang).toBe("Auto");
    expect(getVoice("en-clone").lang).toBe("EN-GB");
  });
  it("records the server's active engine and which engines can clone", async () => {
    vi.mocked(fetchServerVoices).mockResolvedValue({ voices: [], engines: [
      { id: "omnivoice", available: true, supports_cloning: true },
      { id: "kittentts", available: true, supports_cloning: false },
      { id: "cosyvoice", available: false, supports_cloning: true },
    ] });
    expect(useVoices.getState().activeEngine).toBeNull();
    await useVoices.getState().loadServer();
    const { activeEngine, engines } = useVoices.getState();
    expect(activeEngine).toBe("omnivoice");
    expect(engines.map((e) => [e.id, e.available, e.cloning])).toEqual([["omnivoice", true, true], ["kittentts", true, false], ["cosyvoice", false, true]]);
  });
  it("keeps existing voices and surfaces an error when Fish fails", async () => {
    vi.mocked(fetchFishVoices).mockRejectedValue(new Error("Invalid key"));
    vi.mocked(fetchServerVoices).mockResolvedValue(local);
    await useVoices.getState().load();
    expect(useVoices.getState().fishError).toBe("Invalid key");
    expect(getVoice("nova").engine).toBe("openai");
    expect(getVoice("profile").id).toBe("profile");
    vi.mocked(fetchFishVoices).mockResolvedValue(fish);
    await useVoices.getState().loadFish();
    expect(useVoices.getState().fishError).toBeNull();
  });
  it("links voices added from the Studio gallery to their recipe and sends them back on removal", async () => {
    profiles.push(
      { id: "lib", name: "The Librarian", kind: "design", language: "English", personality: "archetype:librarian" },
      { id: "mine", name: "My voice", kind: "clone", language: "English", personality: null },
    );
    vi.mocked(fetchServerVoices).mockResolvedValue({ voices: [{ id: "lib", name: "The Librarian", type: "profile" }, { id: "mine", name: "My voice", type: "profile" }], engines: [] });
    await useVoices.getState().loadServer();
    expect(getVoice("lib")).toMatchObject({ kind: "profile", archetype: "librarian", tags: ["designed"] });
    expect(getVoice("mine").archetype).toBeUndefined();
    profiles.splice(0, 1);
    vi.mocked(fetchServerVoices).mockResolvedValue({ voices: [{ id: "mine", name: "My voice", type: "profile" }], engines: [] });
    await useVoices.getState().remove("lib");
    expect(studioFetch).toHaveBeenCalledWith("/profiles/lib", { method: "DELETE" });
    expect(useVoices.getState().voices.some((v) => v.id === "lib")).toBe(false);
    expect(getVoice("mine").id).toBe("mine");
  });
  it("keeps a voice when VoiceStudio refuses to delete it", async () => {
    profiles.push({ id: "lib", name: "The Librarian", kind: "design", language: "English", personality: "archetype:librarian" });
    vi.mocked(fetchServerVoices).mockResolvedValue({ voices: [{ id: "lib", name: "The Librarian", type: "profile" }], engines: [] });
    await useVoices.getState().loadServer();
    studioFetch.mockRejectedValueOnce(new Error("Profile is locked"));
    await expect(useVoices.getState().remove("lib")).rejects.toThrow("Profile is locked");
    expect(getVoice("lib").archetype).toBe("librarian");
  });
  it("keeps a saved Fish voice's identity outside the current catalogue", () => {
    expect(getVoice("fish:saved-voice")).toMatchObject({ id: "fish:saved-voice", engine: "fish", kind: "preset" });
  });
  it("identifies saved services when their catalogues are unavailable", () => {
    useVoices.setState({ voices: [LOCAL_VOICE] });
    expect(getVoice("nova")).toMatchObject({ id: "nova", name: "Nova", engine: "openai" });
    expect(getVoice("coral~georgia")).toMatchObject({ name: "Savannah", engine: "openai" });
    expect(getVoice("fish:saved-voice").engine).toBe("fish");
    expect(getVoice(DEFAULT_VOICE_ID)).toMatchObject({ name: "Bella", engine: "kittentts" });
    expect(getVoice("saved-profile")).toMatchObject({ id: "saved-profile", kind: "profile", engine: "omnivoice" });
    expect(voiceSource(getVoice("saved-profile"))).toBe("VoiceStudio");
  });
  it("keeps VoiceStudio as the default even when cloud voices arrive first", () => {
    useVoices.setState({ voices: [getVoice("nova"), LOCAL_VOICE] });
    expect(getVoice(null)).toMatchObject({ id: DEFAULT_VOICE_ID, engine: "kittentts" });
  });
});
