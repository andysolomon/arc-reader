import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiRejected, ApiUnreachable } from "./types";
import { apiSynthesize, openaiSpeechSynthesize, synthesize, cacheKey, localChunk, startsFromWords } from "./providers";
import { clipVoicedShare, joinClips } from "./audio";
import { addUsage } from "../lib/usage";
import { audioCache } from "../lib/db";
import { preparedAudio } from "./preparation";

vi.mock("../lib/db", () => ({ audioCache: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } }));
vi.mock("./preparation", () => ({ preparedAudio: vi.fn(async () => null) }));
vi.mock("./audio", async (importOriginal) => ({ ...await importOriginal<typeof import("./audio")>(), joinClips: vi.fn(async () => null), clipVoicedShare: vi.fn(async () => undefined) }));
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
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toMatchObject({ model: "tts-1", num_step: 16 });
  });

  it.each(["omnivoice", "omnivoice-subprocess"])("uses the normal 16-step preset for %s", async (engine) => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" })));
    await openaiSpeechSynthesize({ text: "Hello there.", voice: "default", engine });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: engine, num_step: 16 });
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

  it("cache keys separate OpenAI models, keeping the steady model on the key its clips already use", () => {
    const legacy = cacheKey({ text: "t", voice: "nova", engine: "openai" });
    expect(cacheKey({ text: "t", voice: "nova", engine: "openai", openaiModel: "gpt-4o-mini-tts" })).toBe(legacy);
    expect(cacheKey({ text: "t", voice: "nova", engine: "openai", openaiModel: "tts-1" })).not.toBe(legacy);
    // Accent voices always use the steady model, whatever is chosen.
    expect(cacheKey({ text: "t", voice: "coral~georgia", engine: "openai", openaiModel: "tts-1" })).toBe(cacheKey({ text: "t", voice: "coral~georgia", engine: "openai" }));
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

  it("does not wait out a long Retry-After: live listening retries within seconds", async () => {
    vi.useFakeTimers();
    try {
      const { apiSynthesize, BUSY_RETRY_CAP_MS } = await import("./providers");
      fetchMock
        .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "30" } }))
        .mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
      const pending = apiSynthesize({ text: "x", voice: "v", engine: "kittentts" });
      await vi.advanceTimersByTimeAsync(BUSY_RETRY_CAP_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await pending).source).toBe("api");
    } finally {
      vi.useRealTimers();
    }
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
    expect(JSON.parse(String(init.body))).not.toHaveProperty("num_step");
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

  it("uses tts-1 when it is chosen, without instructions or token streaming", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "nova", engine: "openai", openaiModel: "tts-1" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "tts-1", voice: "nova" });
    expect(body).not.toHaveProperty("instructions");
    expect(body).not.toHaveProperty("stream_format");
  });

  it("keeps accent voices on the steady model when tts-1 is chosen", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await openaiSpeechSynthesize({ text: "x", voice: "coral~georgia", engine: "openai", openaiModel: "tts-1" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.model).toBe("gpt-4o-mini-tts");
    expect(body.instructions).toMatch(/Georgia Southern accent/);
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

  it("records tts-1 generations under tts-1", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
    await synthesize({ ...req, openaiModel: "tts-1" });
    expect(addUsage).toHaveBeenCalledWith(expect.objectContaining({ engine: "openai", model: "tts-1", text: req.text }));
  });

  it("uses prepared audio without synthesizing or recording another generation", async () => {
    const local = { text: "Prepared passage.", voice: "v", engine: "kittentts" };
    vi.mocked(preparedAudio).mockResolvedValueOnce(new Response("audio", { headers: { "content-type": "audio/mpeg", "x-duration": "3" } }));
    const chunk = await synthesize(local);
    expect(chunk).toMatchObject({ source: "cache", duration: 3 });
    expect(await chunk.audio?.text()).toBe("audio");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addUsage).not.toHaveBeenCalled();
    expect(audioCache.put).toHaveBeenCalledWith(expect.objectContaining({ key: cacheKey(local), duration: 3 }));
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

describe("sentence clips cached before passages", () => {
  const parts = [["One", "two."], ["Three", "four."]];
  const opts = { text: "One two. Three four.", voice: "nova", engine: "openai", parts, sentences: ["One two.", "Three four."] };
  const sentenceKeys = new Set(opts.sentences.map((text) => cacheKey({ ...opts, text })));
  const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(audioCache.get).mockImplementation(async (key: string) => sentenceKeys.has(key)
      ? { key, blob: new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), mime: "audio/mpeg", duration: 1.5, words: [{ start: 0.3, end: 0.6 }, { start: 0.7, end: 1.1 }], createdAt: 0 }
      : undefined);
  });
  afterEach(() => {
    vi.mocked(audioCache.get).mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });

  it("joins them instead of paying for the passage again", async () => {
    const audio = new Blob([new Uint8Array(44)], { type: "audio/wav" });
    vi.mocked(joinClips).mockResolvedValueOnce({ audio, duration: 2.6, starts: [0, 1.4], trims: [0, 0.25], lead: 0.3, tail: 0.4, loudness: -18 });
    const c = await synthesize(opts);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addUsage).not.toHaveBeenCalled();
    expect(audioCache.put).not.toHaveBeenCalled();
    expect(c).toMatchObject({ source: "cache", audio, mime: "audio/wav", duration: 2.6, starts: [0, 1.4], loudness: -18 });
    // The second clip's words move by its place in the passage, less what was cut from its front.
    expect(c.words![2].start).toBeCloseTo(0.3 - 0.25 + 1.4);
  });

  it("generates the passage when a sentence is missing or the clips cannot be decoded", async () => {
    await synthesize(opts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.mocked(audioCache.get).mockImplementation(async (key: string) => key === [...sentenceKeys][0]
      ? { key, blob: new Blob([new Uint8Array(8)]), mime: "audio/mpeg", duration: 1, createdAt: 0 } : undefined);
    await synthesize(opts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(joinClips).toHaveBeenCalledTimes(1);
  });
});

describe("garbled speech", () => {
  const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { status: 200 }));
  const voiced = vi.mocked(clipVoicedShare);
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(audioCache.put).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    voiced.mockReset();
    voiced.mockResolvedValue(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks again when a take is mostly unvoiced noise", async () => {
    voiced.mockResolvedValueOnce(0.05).mockResolvedValueOnce(0.8);
    const c = await apiSynthesize({ text: "When writing an evaluator.", voice: "v", engine: "omnivoice" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(c.voiced).toBe(0.8);
  });

  it("keeps the best take after the retries run out", async () => {
    voiced.mockResolvedValueOnce(0.05).mockResolvedValueOnce(0.12).mockResolvedValueOnce(0.02);
    const c = await apiSynthesize({ text: "12", voice: "v", engine: "omnivoice" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(c.voiced).toBe(0.12);
  });

  it("accepts a take that cannot be measured", async () => {
    const c = await apiSynthesize({ text: "Hello.", voice: "v", engine: "kittentts" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c.voiced).toBeUndefined();
  });

  it("does not check or retry OpenAI speech", async () => {
    voiced.mockResolvedValue(0.01);
    const c = await apiSynthesize({ text: "Hello.", voice: "nova", engine: "openai" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(voiced).not.toHaveBeenCalled();
    expect(c.voiced).toBeUndefined();
  });

  it("regenerates a garbled clip cached before voicing was checked, and stores the clean take", async () => {
    const req = { text: "Write an evaluator.", voice: "v", engine: "omnivoice" };
    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: cacheKey(req), blob: new Blob([new Uint8Array(8)]), mime: "audio/mpeg", duration: 3, loudness: -20, createdAt: 0 });
    voiced.mockResolvedValueOnce(0.07).mockResolvedValueOnce(0.7);
    const c = await synthesize(req);
    expect(c.source).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audioCache.put).toHaveBeenCalledWith(expect.objectContaining({ key: cacheKey(req), voiced: 0.7 }));
  });

  it("marks a clean legacy cached clip as checked without regenerating it", async () => {
    const req = { text: "Write an evaluator.", voice: "v", engine: "omnivoice" };
    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: cacheKey(req), blob: new Blob([new Uint8Array(8)]), mime: "audio/mpeg", duration: 3, loudness: -20, createdAt: 0 });
    voiced.mockResolvedValueOnce(0.6);
    const c = await synthesize(req);
    expect(c.source).toBe("cache");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audioCache.put).toHaveBeenCalledWith(expect.objectContaining({ voiced: 0.6 }));
  });

  it("does not re-measure a cached clip already checked", async () => {
    const req = { text: "Write an evaluator.", voice: "v", engine: "omnivoice" };
    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: cacheKey(req), blob: new Blob([new Uint8Array(8)]), mime: "audio/mpeg", duration: 3, loudness: -20, voiced: 0.6, createdAt: 0 });
    await synthesize(req);
    expect(voiced).not.toHaveBeenCalled();
  });

  it("replaces a garbled prepared clip with a fresh take", async () => {
    const req = { text: "Write an evaluator.", voice: "v", engine: "omnivoice" };
    vi.mocked(preparedAudio).mockResolvedValueOnce(new Response("audio", { headers: { "content-type": "audio/mpeg", "x-duration": "3" } }));
    voiced.mockResolvedValueOnce(0.07).mockResolvedValueOnce(0.7);
    const c = await synthesize(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({ source: "api", voiced: 0.7 });
  });
});
