import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiRejected, ApiUnreachable } from "./types";
import { openaiSpeechSynthesize, synthesize, cacheKey } from "./providers";

vi.mock("../lib/db", () => ({ audioCache: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } }));
vi.mock("../lib/usage", () => ({ addUsage: vi.fn() }));

// VITE_API_BASE=/api/vs comes from vitest.config.ts
describe("openaiSpeechSynthesize", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the OpenAI shape at 1× and returns audio with an estimated duration when decode is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(64)], { type: "audio/mpeg" }), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const c = await openaiSpeechSynthesize({ text: "Hello there, world.", voice: "expr-voice-2-f", engine: "kittentts" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/vs/v1/audio/speech");
    expect(JSON.parse(String(init.body))).toEqual({ model: "kittentts", input: "Hello there, world.", voice: "expr-voice-2-f", response_format: "mp3", speed: 1 });
    expect(c.source).toBe("api");
    expect(c.mime).toBe("audio/mpeg");
    expect(c.duration).toBeCloseTo((3 + 1.2) / 2.83);
  });

  it("sends cloned profiles with the active-engine alias", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "prof-1", engine: "kittentts", profile: true });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).model).toBe("tts-1");
  });

  it("maps network failures and gateway errors to ApiUnreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "kittentts" })).rejects.toBeInstanceOf(ApiUnreachable);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 502 }));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "kittentts" })).rejects.toBeInstanceOf(ApiUnreachable);
  });

  it("maps 401 and 4xx to ApiRejected with the server's message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "kittentts" })).rejects.toBeInstanceOf(ApiRejected);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Engine 'nope' is not available" } }), { status: 400, headers: { "content-type": "application/json" } }));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "nope" })).rejects.toThrow("Engine 'nope' is not available");
  });

  it("synthesize falls back to the local chunk and reports offline / rejected", async () => {
    const onOffline = vi.fn(), onRejected = vi.fn();
    fetchMock.mockRejectedValueOnce(new TypeError("down"));
    const a = await synthesize({ text: "a b c", voice: "v", engine: "kittentts", onOffline, onRejected });
    expect(a.source).toMatch(/local|estimate/);
    expect(onOffline).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    await synthesize({ text: "a b c", voice: "v", engine: "kittentts", onOffline, onRejected });
    expect(onRejected).toHaveBeenCalledWith("The speech server rejected the API key");
  });

  it("cache keys include the engine", async () => {
    expect(cacheKey({ text: "t", voice: "v", engine: "kittentts" })).not.toBe(cacheKey({ text: "t", voice: "v", engine: "supertonic3" }));
  });
});

describe("alignWords", () => {
  it("accepts an exact count match", async () => {
    const { alignWords } = await import("./providers");
    expect(alignWords([{ word: "Hi", start: 0, end: 0.2 }, { word: "there.", start: 0.2, end: 0.5 }], ["Hi", "there."])).toEqual([{ start: 0, end: 0.2 }, { start: 0.2, end: 0.5 }]);
  });
  it("merges split tokens by normalized text and rejects mismatches", async () => {
    const { alignWords } = await import("./providers");
    expect(alignWords([{ word: "to", start: 0, end: 0.1 }, { word: "-day", start: 0.1, end: 0.3 }, { word: "works", start: 0.3, end: 0.6 }], ["to-day", "works"])).toEqual([{ start: 0, end: 0.3 }, { start: 0.3, end: 0.6 }]);
    expect(alignWords([{ word: "something", start: 0, end: 1 }], ["entirely", "different"])).toBeNull();
  });
});

describe("apiSynthesize queue", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("runs speech requests one at a time", async () => {
    const { apiSynthesize } = await import("./providers");
    let inFlight = 0, maxInFlight = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 });
    });
    await Promise.all([1, 2, 3].map((i) => apiSynthesize({ text: `s${i}`, voice: "v", engine: "kittentts" })));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });

  it("retries a 429 with backoff instead of failing", async () => {
    const { apiSynthesize } = await import("./providers");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    const c = await apiSynthesize({ text: "x", voice: "v", engine: "kittentts" });
    expect(c.source).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
