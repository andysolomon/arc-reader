import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiSynthesize, cacheKey, fetchFishVoices, fishSynthesize, synthesize } from "./providers";
import { ApiBusy, ApiRejected } from "./types";
import { audioCache } from "../lib/db";

vi.mock("../lib/db", () => ({ audioCache: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } }));
vi.mock("../lib/usage", async (importOriginal) => ({ ...await importOriginal<typeof import("../lib/usage")>(), addUsage: vi.fn() }));
const req = { text: "Hello from Fish Audio.", voice: "fish:voice-123", engine: "fish" };
const audio = () => new Response(new Uint8Array(64), { headers: { "Content-Type": "audio/mpeg" } });
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Fish Audio", () => {
  it("routes speech to Fish with its reference ID, selected model and fixed synthesis speed", async () => {
    fetchMock.mockResolvedValueOnce(audio());
    const signal = new AbortController().signal;
    const chunk = await apiSynthesize({ ...req, signal });
    expect(fetchMock).toHaveBeenCalledWith("/api/fish/v1/tts", expect.objectContaining({
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg", model: "s2.1-pro" },
      body: JSON.stringify({ text: req.text, reference_id: "voice-123", format: "mp3", prosody: { speed: 1 } }),
    }));
    expect(chunk).toMatchObject({ source: "api", mime: "audio/mpeg" });
    expect(chunk.duration).toBeGreaterThan(0);
  });

  it("keeps Fish routing independent of the legacy VoiceStudio contract", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_TTS_PROVIDER", "readaloud");
    const providers = await import("./providers");
    fetchMock.mockResolvedValueOnce(audio());
    await providers.apiSynthesize(req);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/fish/v1/tts");
  });

  it("includes the Fish model in cache identity and returns cached audio without requesting it again", async () => {
    expect(cacheKey(req)).toContain("fish:s2.1-pro|fish:voice-123|");
    expect(cacheKey(req)).not.toBe(cacheKey({ ...req, engine: "openai" }));
    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: cacheKey(req), blob: new Blob(["audio"]), mime: "audio/mpeg", duration: 1, createdAt: 0 });
    expect((await synthesize(req)).source).toBe("cache");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports insufficient credit and uses local fallback without marking other providers offline", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "Insufficient balance" }, { status: 402 }));
    const onRejected = vi.fn(), onOffline = vi.fn();
    expect((await synthesize({ ...req, onRejected, onOffline })).source).toMatch(/local|estimate/);
    expect(onRejected).toHaveBeenCalledWith("Insufficient balance");
    expect(onOffline).not.toHaveBeenCalled();
  });

  it("rejects empty audio, HTML responses, invalid keys, and rate limits", async () => {
    fetchMock.mockResolvedValueOnce(new Response(""));
    await expect(fishSynthesize(req)).rejects.toBeInstanceOf(ApiRejected);
    fetchMock.mockResolvedValueOnce(new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(fishSynthesize(req)).rejects.toThrow("no playable audio");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(fishSynthesize(req)).rejects.toThrow("rejected the API key");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    await expect(fishSynthesize(req)).rejects.toBeInstanceOf(ApiBusy);
  });

  it("does not send cancelled requests or retry an abort as a local voice", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(synthesize({ ...req, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads voice metadata and drops malformed entries", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [{ _id: "v1", title: "Narrator", languages: ["en"] }, { title: "Missing ID" }] }));
    expect(await fetchFishVoices()).toEqual([{ _id: "v1", title: "Narrator", languages: ["en"] }]);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/fish/model?");
  });
});
