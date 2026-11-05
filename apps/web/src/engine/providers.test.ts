import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiRejected, ApiUnreachable } from "./types";
import { apiSynthesize, openaiSpeechSynthesize, synthesize, cacheKey, localChunk, startsFromWords } from "./providers";
import { addUsage } from "../lib/usage";
import { audioCache } from "../lib/db";

vi.mock("../lib/db", () => ({ audioCache: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } }));
vi.mock("../lib/usage", async (importOriginal) => ({ ...await importOriginal<typeof import("../lib/usage")>(), addUsage: vi.fn() }));

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
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tts: { active: "omnivoice", backends: [{ id: "omnivoice", supports_cloning: true }] } })))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" })));
    await openaiSpeechSynthesize({ text: "x", voice: "prof-1", engine: "omnivoice", profile: true });
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)).model).toBe("tts-1");
  });

  it("refuses to silently substitute a preset for a cloned profile", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tts: { active: "kittentts", backends: [{ id: "kittentts", supports_cloning: false }] } })));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "prof-1", engine: "kittentts", profile: true })).rejects.toThrow("cloning-capable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves model-license errors instead of blaming the API key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: "Review model terms first" } }), { status: 403 }));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "omnivoice" })).rejects.toThrow("Review model terms first");
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

  it("synthesize rethrows when the caller refuses the browser-voice fallback", async () => {
    const onOffline = vi.fn();
    fetchMock.mockRejectedValueOnce(new TypeError("down"));
    await expect(synthesize({ text: "a b c", voice: "v", engine: "kittentts", fallbackLocal: false, onOffline })).rejects.toBeInstanceOf(ApiUnreachable);
    expect(onOffline).not.toHaveBeenCalled();
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

describe("OpenAI engine routing", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("sends OpenAI voices to the OpenAI base with the OpenAI model", async () => {
    const { openaiSpeechSynthesize } = await import("./providers");
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "nova", engine: "openai" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/oa/v1/audio/speech");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-4o-mini-tts", voice: "nova" });
  });

  it("asks gpt-4o-mini-tts for one steady delivery on every request", async () => {
    const { openaiSpeechSynthesize } = await import("./providers");
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "sage", engine: "openai" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.instructions).toMatch(/same calm tone, pace, pitch and volume/);
    expect(body.instructions).toMatch(/exactly as written/);
  });

  it("sends accent voices as their base voice with accent instructions ahead of the steady delivery", async () => {
    const { openaiSpeechSynthesize } = await import("./providers");
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "coral~georgia", engine: "openai" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "gpt-4o-mini-tts", voice: "coral" });
    expect(body.instructions).toMatch(/Georgia Southern accent.*same calm tone/);
  });

  it("leaves VoiceStudio and tts-1 requests without instructions", async () => {
    const { openaiSpeechSynthesize } = await import("./providers");
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "expr-voice-2-f", engine: "kittentts" });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).not.toHaveProperty("instructions");
  });

  it("does not queue OpenAI requests behind VoiceStudio ones", async () => {
    const { apiSynthesize } = await import("./providers");
    let inFlight = 0, maxInFlight = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 });
    });
    await Promise.all([1, 2, 3].map((i) => apiSynthesize({ text: `s${i}`, voice: "nova", engine: "openai" })));
    expect(maxInFlight).toBe(3);
  });
});

describe("generation accounting", () => {
  const req = { text: "Hello there.", voice: "nova", engine: "openai" };
  const fetchMock = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("requests speech events and records the model plus reported tokens once", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      'data: {"type":"speech.audio.delta","audio":"AQID"}\n\ndata: {"type":"speech.audio.done","usage":{"input_tokens":4,"output_tokens":50}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ));
    const chunk = await synthesize(req);
    expect(chunk.source).toBe("api");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "gpt-4o-mini-tts", stream_format: "sse" });
    expect(addUsage).toHaveBeenCalledTimes(1);
    expect(addUsage).toHaveBeenCalledWith(expect.objectContaining({ engine: "openai", model: "gpt-4o-mini-tts", text: req.text, tokens: { inputTokens: 4, outputTokens: 50 } }));
  });

  it("records only a successful retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0.001" } }))
      .mockResolvedValueOnce(new Response(new Blob(["audio"], { type: "audio/mpeg" })));
    await apiSynthesize(req);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(addUsage).toHaveBeenCalledTimes(1);
  });

  it("does not count cache playback, local speech, failed requests, or cancellations", async () => {
    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: cacheKey(req), blob: new Blob(["audio"]), mime: "audio/mpeg", duration: 1, createdAt: 0 });
    expect((await synthesize(req)).source).toBe("cache");
    await synthesize({ ...req, forceLocal: true });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await synthesize(req);
    const ac = new AbortController(); ac.abort();
    await expect(synthesize({ ...req, signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(addUsage).not.toHaveBeenCalled();
  });

  it("does not count truncated streams or empty audio", async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {"type":"speech.audio.delta","audio":"AQID"}\n\n', { headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(""));
    await synthesize(req);
    await synthesize(req);
    expect(addUsage).not.toHaveBeenCalled();
  });
});

describe("passage clips", () => {
  it("a local passage speaks sentence by sentence, each with its own estimate", () => {
    const c = localChunk("a b. c d e.", [["a", "b."], ["c", "d", "e."]]);
    expect(c.starts).toEqual([0, (2 + 1.2) / 2.83]);
    expect(c.duration).toBeCloseTo((2 + 1.2) / 2.83 + (3 + 1.2) / 2.83);
    expect(localChunk("a b.").starts).toBeUndefined();
  });

  it("derives sentence starts from word timings, a hair ahead of the first word", () => {
    const words = [{ start: 0.1, end: 0.4 }, { start: 0.5, end: 0.9 }, { start: 1.6, end: 2.0 }, { start: 2.1, end: 2.4 }];
    expect(startsFromWords(words, [["a", "b"], ["c", "d"]])).toEqual([0, 1.57]);
    expect(startsFromWords(words.slice(0, 2), [["a", "b"], ["c", "d"]])).toBeNull();
  });

  it("stores and replays sentence starts with the cached clip, and shares a one-sentence clip without them", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(64)], { type: "audio/mpeg" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const put = vi.mocked(audioCache.put);
    put.mockClear();
    const parts = [["One", "two."], ["Three", "four", "five", "six."]];
    const c = await synthesize({ text: "One two. Three four five six.", voice: "v", engine: "kittentts", parts, words: parts.flat() });
    // No decoder under jsdom: word-share estimate over the estimated duration.
    expect(c.starts).toHaveLength(2);
    expect(c.starts![0]).toBe(0);
    expect(c.starts![1]).toBeCloseTo(c.duration * (2 / 6));
    await new Promise((r) => setTimeout(r, 0));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toMatchObject({ starts: c.starts });

    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: "k", blob: new Blob([new Uint8Array(8)]), mime: "audio/mpeg", duration: 3, starts: [0, 1.2], loudness: -20, createdAt: 0 });
    const cached = await synthesize({ text: "One two. Three four five six.", voice: "v", engine: "kittentts", parts });
    expect(cached).toMatchObject({ source: "cache", starts: [0, 1.2], loudness: -20 });

    const single = await synthesize({ text: "Only one.", voice: "v", engine: "kittentts", parts: [["Only", "one."]] });
    expect(single.starts).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
