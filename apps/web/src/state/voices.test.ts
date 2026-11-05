import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFishVoices, fetchServerVoices } from "../engine/providers";
import { getVoice, useVoices } from "./voices";

vi.mock("../engine/providers", async (original) => ({
  ...await original<typeof import("../engine/providers")>(),
  fetchFishVoices: vi.fn(), fetchServerVoices: vi.fn(),
}));
const initial = useVoices.getState();
beforeEach(() => { vi.resetAllMocks(); useVoices.setState(initial, true); });
const fish = [{ _id: "narrator", title: "Narrator", languages: ["en"] }];
const local = { voices: [{ id: "profile", name: "My voice", type: "profile" }], engines: [{ id: "kittentts", available: true }] };

describe("voice providers", () => {
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
  it("keeps a saved Fish voice's identity outside the current catalogue", () => {
    expect(getVoice("fish:saved-voice")).toMatchObject({ id: "fish:saved-voice", engine: "fish", kind: "preset" });
  });
});
