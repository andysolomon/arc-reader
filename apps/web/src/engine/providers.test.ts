import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowser, mixed, noise, replies, RATE, serve, speech, undecodable, voice, type Sent } from "./fakeSpeech";
import { ApiRejected, ApiUnreachable } from "./types";
import { alignWords, apiSynthesize, BUSY_RETRY_CAP_MS, cacheKey, localChunk, openaiSpeechSynthesize, prepareInBackground, startsFromWords, synthesize, type SynthOptions } from "./providers";
import { GARBLED_BELOW, voicedShare } from "./voicing";
import { encodeWav } from "./audio";
import { setVoiceRevision, setVoiceRevisions, voiceIdOfKeyPart } from "./voiceRevisions";
import { audioCache, type AudioRecord } from "../lib/db";
import { getUsageSnapshot } from "../lib/usage";

// VITE_API_BASE=/api/vs and the other bases come from vitest.config.ts. Node has no audio
// element, so this device can't play WebM (providers.webm.test.ts covers one that can).
const browser = installBrowser();
let server = serve(replies());
beforeEach(async () => {
  browser.clearStorage();
  setVoiceRevisions({});
  await audioCache.clear();
  server = serve(replies());
});

const bodyOf = (sent: Sent) => sent.body as Record<string, unknown>;
const mp3 = () => new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { headers: { "content-type": "audio/mpeg" } });
const usage = () => getUsageSnapshot().rows;
const saved = (req: Parameters<typeof cacheKey>[0]) => audioCache.get(cacheKey(req));
const store = (req: Parameters<typeof cacheKey>[0], samples: Float32Array | Blob, extra: Partial<AudioRecord> = {}) => audioCache.put({
  key: cacheKey(req), blob: samples instanceof Blob ? samples : encodeWav(samples, RATE), mime: "audio/wav", duration: 1, createdAt: 0, ...extra,
});

/** The web server holds a finished reading of these passages, with `clip` as each one's audio. */
async function preparedOnServer(requests: SynthOptions[], clip: () => Response, then: (sent: Sent) => Response = replies()) {
  const job = { id: `job-${Math.random().toString(36).slice(2)}`, state: "done", done: requests.length, total: requests.length };
  server = serve((sent) => {
    if (sent.url === "/api/preparations") return Response.json(job, { status: 202 });
    if (sent.url === `/api/preparations/${job.id}`) return Response.json(job);
    if (sent.url.startsWith(`/api/preparations/${job.id}/audio/`)) return clip();
    return then(sent);
  });
  await prepareInBackground(requests, 0);
}

describe("speaking through the OpenAI-compatible API", () => {
  it("posts the OpenAI shape at 1× and estimates the duration of audio it cannot decode", async () => {
    server = serve(replies(undecodable()));
    const c = await openaiSpeechSynthesize({ text: "Hello there, world.", voice: "expr-voice-2-f", engine: "kittentts" });
    expect(server.sent.map((s) => s.url)).toEqual(["/api/vs/v1/audio/speech"]);
    expect(bodyOf(server.sent[0])).toEqual({ model: "kittentts", input: "Hello there, world.", voice: "expr-voice-2-f", response_format: "mp3", speed: 1 });
    expect(c).toMatchObject({ source: "api", mime: "audio/mpeg" });
    expect(c.duration).toBeCloseTo((3 + 1.2) / 2.83);
  });

  it("measures the duration of audio it can decode", async () => {
    server = serve(replies(speech(voice(1.5))));
    expect((await openaiSpeechSynthesize({ text: "Hello there.", voice: "v", engine: "kittentts" })).duration).toBeCloseTo(1.5);
  });

  it("sends cloned profiles with the active-engine alias", async () => {
    server = serve(replies(Response.json({ tts: { active: "omnivoice", backends: [{ id: "omnivoice", supports_cloning: true }] } }), speech()));
    await openaiSpeechSynthesize({ text: "x", voice: "prof-1", engine: "omnivoice", profile: true });
    expect(server.sent.map((s) => s.url)).toEqual(["/api/vs/engines", "/api/vs/v1/audio/speech"]);
    expect(bodyOf(server.generated()[0])).toMatchObject({ model: "tts-1", voice: "prof-1", num_step: 16 });
  });

  it.each(["omnivoice", "omnivoice-subprocess"])("uses the normal 16-step preset for %s", async (engine) => {
    server = serve(replies(speech()));
    await openaiSpeechSynthesize({ text: "Hello there.", voice: "default", engine });
    expect(bodyOf(server.generated()[0])).toMatchObject({ model: engine, num_step: 16 });
  });

  // A cloned voice is someone's real voice: reading it in a stock voice instead must never happen quietly.
  it("never reads a cloned voice in a preset voice when the active engine cannot clone", async () => {
    const noCloning = () => Response.json({ tts: { active: "kittentts", backends: [{ id: "kittentts", supports_cloning: false }] } });
    server = serve(replies(noCloning(), noCloning()));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "prof-1", engine: "kittentts", profile: true })).rejects.toThrow("cloning-capable");
    const onRejected = vi.fn();
    const c = await synthesize({ text: "Read this in my voice.", voice: "prof-1", engine: "kittentts", profile: true, onRejected });
    expect(server.generated()).toEqual([]);
    expect(onRejected).toHaveBeenCalledWith(expect.stringContaining("cloning-capable"));
    expect(c).toMatchObject({ source: expect.stringMatching(/local|estimate/) });
    expect(c.audio).toBeUndefined();
    expect(await saved({ text: "Read this in my voice.", voice: "prof-1", engine: "kittentts" })).toBeUndefined();
    expect(usage()).toEqual([]);
  });

  it("never reads a cloned voice on an engine other than the one it was saved for", async () => {
    server = serve(replies(Response.json({ tts: { active: "cosyvoice", backends: [{ id: "cosyvoice", supports_cloning: true }] } })));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "prof-1", engine: "omnivoice", profile: true })).rejects.toThrow("engine changed");
    expect(server.generated()).toEqual([]);
  });

  it("passes a model-licence refusal to the reader word for word instead of blaming the API key", async () => {
    const licence = () => Response.json({ detail: { message: "Review model terms first" } }, { status: 403 });
    server = serve(replies(licence(), licence()));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "omnivoice" })).rejects.toThrow("Review model terms first");
    const onRejected = vi.fn();
    await synthesize({ text: "x", voice: "v", engine: "omnivoice", onRejected });
    expect(onRejected).toHaveBeenCalledExactlyOnceWith("Review model terms first");
  });

  it("treats network failures and gateway errors as an unreachable server", async () => {
    server = serve(replies(new TypeError("Failed to fetch"), new Response("{}", { status: 502 })));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "kittentts" })).rejects.toBeInstanceOf(ApiUnreachable);
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "kittentts" })).rejects.toBeInstanceOf(ApiUnreachable);
  });

  it("treats 401 and other 4xx as a refusal, with the server's own message", async () => {
    server = serve(replies(new Response("{}", { status: 401 }), Response.json({ error: { message: "Engine 'nope' is not available" } }, { status: 400 })));
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "kittentts" })).rejects.toBeInstanceOf(ApiRejected);
    await expect(openaiSpeechSynthesize({ text: "x", voice: "v", engine: "nope" })).rejects.toThrow("Engine 'nope' is not available");
  });

  it("falls back to the browser voice and says whether the server was down or refused the key", async () => {
    const onOffline = vi.fn(), onRejected = vi.fn();
    server = serve(replies(new TypeError("down"), new Response("{}", { status: 403 })));
    expect((await synthesize({ text: "a b c", voice: "v", engine: "kittentts", onOffline, onRejected })).source).toMatch(/local|estimate/);
    expect(onOffline).toHaveBeenCalledTimes(1);
    await synthesize({ text: "a b c", voice: "v", engine: "kittentts", onOffline, onRejected });
    expect(onRejected).toHaveBeenCalledExactlyOnceWith("The speech server rejected the API key");
  });

  it("fails instead of quietly switching to the browser voice when the caller refuses that fallback", async () => {
    const onOffline = vi.fn();
    server = serve(replies(new TypeError("down")));
    await expect(synthesize({ text: "a b c", voice: "v", engine: "kittentts", fallbackLocal: false, onOffline })).rejects.toBeInstanceOf(ApiUnreachable);
    expect(onOffline).not.toHaveBeenCalled();
  });
});

describe("the audio cache", () => {
  const req = { text: "Hello there.", voice: "v", engine: "kittentts" };

  it("saves a new clip and plays it back later without asking the server again", async () => {
    server = serve(replies(speech(voice(1))));
    const first = await synthesize(req);
    expect(first.source).toBe("api");
    expect(await saved(req)).toMatchObject({ mime: "audio/wav", duration: 1 });
    const again = await synthesize(req);
    expect(again).toMatchObject({ source: "cache", duration: 1 });
    expect(await again.audio!.arrayBuffer()).toEqual(await first.audio!.arrayBuffer());
    expect(server.generated()).toHaveLength(1);
    expect(usage()).toEqual([expect.objectContaining({ provider: "voicestudio", model: "kittentts", requests: 1 })]);
  });

  it("never plays one engine's clip for another", async () => {
    server = serve(replies(speech(), speech()));
    await synthesize(req);
    expect((await synthesize({ ...req, engine: "supertonic3" })).source).toBe("api");
    expect(server.generated().map((s) => bodyOf(s).model)).toEqual(["kittentts", "supertonic3"]);
  });

  it("keeps OpenAI clips under the steady model they were saved with, and generates again for tts-1", async () => {
    const nova = { text: "t", voice: "nova", engine: "openai" };
    server = serve(replies(mp3(), mp3(), mp3()));
    await synthesize(nova);
    expect((await synthesize({ ...nova, openaiModel: "gpt-4o-mini-tts" })).source).toBe("cache");
    expect((await synthesize({ ...nova, openaiModel: "tts-1" })).source).toBe("api");
    // Accent voices always use the steady model, whatever is chosen.
    const accent = { ...nova, voice: "coral~georgia" };
    await synthesize(accent);
    expect((await synthesize({ ...accent, openaiModel: "tts-1" })).source).toBe("cache");
    expect(server.generated().map((s) => bodyOf(s).model)).toEqual(["gpt-4o-mini-tts", "tts-1", "gpt-4o-mini-tts"]);
  });

  it("stops replaying a re-recorded clone's old clips, and replays them again if the re-recording is undone", async () => {
    const clone = { text: "t", voice: "ab12cd34", engine: "omnivoice" };
    server = serve(replies(speech(), speech()));
    await synthesize(clone);
    setVoiceRevision("ab12cd34", "9f8e7d6c");
    expect((await synthesize(clone)).source).toBe("api");
    // The library finds saved voices by reading them back out of the cache's keys.
    expect(new Set((await audioCache.keys()).map((key) => voiceIdOfKeyPart(String(key).split("|")[1])))).toEqual(new Set(["ab12cd34"]));
    expect(voiceIdOfKeyPart("coral~georgia")).toBe("coral~georgia");
    setVoiceRevisions({});
    expect((await synthesize(clone)).source).toBe("cache");
    expect(server.generated()).toHaveLength(2);
  });
});

describe("the VoiceStudio queue", () => {
  it("sends speech requests one at a time", async () => {
    let inFlight = 0, maxInFlight = 0;
    server = serve(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return speech();
    });
    await Promise.all([1, 2, 3].map((i) => apiSynthesize({ text: `s${i}`, voice: "v", engine: "kittentts" })));
    expect(server.generated()).toHaveLength(3);
    expect(maxInFlight).toBe(1);
  });

  it("does not wait out a long Retry-After: live listening retries within seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Cancelled at the end, so a request still waiting can't hold the queue for later tests.
    const listening = new AbortController();
    try {
      server = serve(replies(new Response("{}", { status: 429, headers: { "retry-after": "30" } }), speech()));
      const pending = apiSynthesize({ text: "x", voice: "v", engine: "kittentts", signal: listening.signal });
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(BUSY_RETRY_CAP_MS - 1);
      expect(server.generated()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(server.generated()).toHaveLength(2);
      expect((await pending).source).toBe("api");
    } finally {
      listening.abort();
      vi.useRealTimers();
    }
  });

  it("asks again after a 429 instead of failing, and bills only the request that worked", async () => {
    server = serve(replies(new Response("", { status: 429, headers: { "retry-after": "0.001" } }), mp3()));
    expect((await apiSynthesize({ text: "Hello there.", voice: "nova", engine: "openai" })).source).toBe("api");
    expect(server.generated()).toHaveLength(2);
    expect(usage()).toEqual([expect.objectContaining({ provider: "openai", requests: 1 })]);
  });

  it("does not queue OpenAI requests behind each other", async () => {
    let inFlight = 0, maxInFlight = 0;
    server = serve(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return mp3();
    });
    await Promise.all([1, 2, 3].map((i) => apiSynthesize({ text: `s${i}`, voice: "nova", engine: "openai" })));
    expect(maxInFlight).toBe(3);
  });
});

describe("OpenAI requests", () => {
  const sentFor = async (req: Parameters<typeof openaiSpeechSynthesize>[0]) => {
    server = serve(replies(mp3()));
    await openaiSpeechSynthesize(req);
    return server.generated()[0];
  };

  it("go to the OpenAI base with the OpenAI model", async () => {
    const sent = await sentFor({ text: "x", voice: "nova", engine: "openai" });
    expect(sent.url).toBe("/api/oa/v1/audio/speech");
    expect(sent.body).toMatchObject({ model: "gpt-4o-mini-tts", voice: "nova" });
    expect(sent.body).not.toHaveProperty("num_step");
  });

  it("ask gpt-4o-mini-tts for one steady delivery every time", async () => {
    const { instructions } = bodyOf(await sentFor({ text: "x", voice: "sage", engine: "openai" }));
    expect(instructions).toMatch(/same calm tone, pace, pitch and volume/);
    expect(instructions).toMatch(/exactly as written/);
  });

  it("send accent voices as their base voice with accent instructions ahead of the steady delivery", async () => {
    const body = bodyOf(await sentFor({ text: "x", voice: "coral~georgia", engine: "openai" }));
    expect(body).toMatchObject({ model: "gpt-4o-mini-tts", voice: "coral" });
    expect(body.instructions).toMatch(/Georgia Southern accent.*same calm tone/);
  });

  it("use tts-1 when it is chosen, without instructions or token streaming", async () => {
    const body = bodyOf(await sentFor({ text: "x", voice: "nova", engine: "openai", openaiModel: "tts-1" }));
    expect(body).toMatchObject({ model: "tts-1", voice: "nova" });
    expect(body).not.toHaveProperty("instructions");
    expect(body).not.toHaveProperty("stream_format");
  });

  it("keep accent voices on the steady model when tts-1 is chosen", async () => {
    const body = bodyOf(await sentFor({ text: "x", voice: "coral~georgia", engine: "openai", openaiModel: "tts-1" }));
    expect(body.model).toBe("gpt-4o-mini-tts");
    expect(body.instructions).toMatch(/Georgia Southern accent/);
  });

  it("are the only ones with instructions", async () => {
    server = serve(replies(speech()));
    await openaiSpeechSynthesize({ text: "x", voice: "expr-voice-2-f", engine: "kittentts" });
    expect(server.generated()[0].body).not.toHaveProperty("instructions");
  });
});

describe("what the usage page bills", () => {
  const req = { text: "Hello there.", voice: "nova", engine: "openai" };

  it("records the model and the tokens OpenAI reports, once per generation", async () => {
    server = serve(replies(new Response(
      'data: {"type":"speech.audio.delta","audio":"AQID"}\n\ndata: {"type":"speech.audio.done","usage":{"input_tokens":4,"output_tokens":50}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    )));
    expect((await synthesize(req)).source).toBe("api");
    expect(server.generated()[0].body).toMatchObject({ model: "gpt-4o-mini-tts", stream_format: "sse" });
    const [row, ...rest] = usage();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ provider: "openai", model: "gpt-4o-mini-tts", requests: 1, characters: req.text.length, inputTokens: 4, outputTokens: 50 });
    expect(row.costUsd).toBeCloseTo((4 * 0.6 + 50 * 12) / 1e6, 12);
  });

  it("records tts-1 generations under tts-1, priced per character", async () => {
    server = serve(replies(mp3()));
    await synthesize({ ...req, openaiModel: "tts-1" });
    expect(usage()).toEqual([expect.objectContaining({ provider: "openai", model: "tts-1", requests: 1, pricing: "$15 / 1M characters" })]);
    expect(usage()[0].costUsd).toBeCloseTo(req.text.length * 15 / 1e6, 12);
  });

  it("plays audio the web server prepared without generating or billing it again, and keeps it", async () => {
    const local = { text: "Prepared passage.", voice: "v", engine: "kittentts" };
    await preparedOnServer([local], () => speech(voice(3)));
    const chunk = await synthesize(local);
    expect(chunk).toMatchObject({ source: "cache" });
    expect(chunk.duration).toBeCloseTo(3);
    expect(server.generated()).toEqual([]);
    expect(usage()).toEqual([]);
    expect((await saved(local))?.duration).toBeCloseTo(3);
  });

  it("generates its own MP3 on a device that can't play the server's WebM", async () => {
    const local = { text: "Prepared passage.", voice: "v", engine: "kittentts" };
    await preparedOnServer([local], () => new Response(new Uint8Array(32), { headers: { "content-type": "audio/webm" } }), replies(mp3()));
    expect(await synthesize(local)).toMatchObject({ source: "api", mime: "audio/mpeg" });
    expect(server.generated()[0].body).toMatchObject({ response_format: "mp3" });
  });

  it("does not bill cache playback, the browser voice, refused requests or cancellations", async () => {
    server = serve(replies(mp3(), new Response("", { status: 401 })));
    await synthesize(req);
    const billed = usage();
    expect(billed).toEqual([expect.objectContaining({ requests: 1 })]);
    expect((await synthesize(req)).source).toBe("cache");
    await synthesize({ ...req, forceLocal: true });
    await synthesize({ ...req, text: "Refused." });
    const ac = new AbortController(); ac.abort();
    await expect(synthesize({ ...req, text: "Cancelled.", signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(usage()).toEqual(billed);
    expect(server.generated()).toHaveLength(2);
  });

  it("does not bill truncated streams or empty audio", async () => {
    server = serve(replies(new Response('data: {"type":"speech.audio.delta","audio":"AQID"}\n\n', { headers: { "content-type": "text/event-stream" } }), new Response("")));
    await synthesize(req);
    await synthesize(req);
    expect(usage()).toEqual([]);
  });
});

describe("passages", () => {
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

  it("aligns transcript words to the text, merging split tokens and rejecting mismatches", () => {
    expect(alignWords([{ word: "Hi", start: 0, end: 0.2 }, { word: "there.", start: 0.2, end: 0.5 }], ["Hi", "there."])).toEqual([{ start: 0, end: 0.2 }, { start: 0.2, end: 0.5 }]);
    expect(alignWords([{ word: "to", start: 0, end: 0.1 }, { word: "-day", start: 0.1, end: 0.3 }, { word: "works", start: 0.3, end: 0.6 }], ["to-day", "works"])).toEqual([{ start: 0, end: 0.3 }, { start: 0.3, end: 0.6 }]);
    expect(alignWords([{ word: "something", start: 0, end: 1 }], ["entirely", "different"])).toBeNull();
  });

  it("saves sentence starts with the clip and plays them back from the cache, and leaves them off one-sentence clips", async () => {
    const parts = [["One", "two."], ["Three", "four", "five", "six."]];
    const passage = { text: "One two. Three four five six.", voice: "v", engine: "kittentts", parts };
    server = serve(() => undecodable());
    const c = await synthesize({ ...passage, words: parts.flat() });
    // Undecodable audio: sentence starts follow each sentence's share of the words.
    expect(c.starts).toEqual([0, expect.closeTo(c.duration * (2 / 6))]);
    expect((await saved(passage))?.starts).toEqual(c.starts);
    expect(await synthesize(passage)).toMatchObject({ source: "cache", starts: c.starts });
    expect(server.generated()).toHaveLength(1);
    expect((await synthesize({ text: "Only one.", voice: "v", engine: "kittentts", parts: [["Only", "one."]] })).starts).toBeUndefined();
  });
});

describe("sentence clips cached before passages", () => {
  const parts = [["One", "two."], ["Three", "four."]];
  const passage = { text: "One two. Three four.", voice: "nova", engine: "openai", parts, sentences: ["One two.", "Three four."] };
  const sentence = (text: string) => ({ ...passage, text });
  /** A sentence clip as saved before passages: 0.3 s of silence, then two words. */
  const sentenceClip = () => { const s = new Float32Array(Math.round(0.3 * RATE) + RATE); s.set(voice(1), Math.round(0.3 * RATE)); return s; };
  const words = [{ start: 0.3, end: 0.6 }, { start: 0.7, end: 1.1 }];

  it("are joined instead of paying for the passage again", async () => {
    for (const text of passage.sentences) await store(sentence(text), sentenceClip(), { words });
    const c = await synthesize(passage);
    expect(server.sent).toEqual([]);
    expect(usage()).toEqual([]);
    expect(await saved(passage)).toBeUndefined();
    expect(c).toMatchObject({ source: "cache", mime: "audio/wav", starts: [0, expect.any(Number)] });
    expect(c.duration).toBeGreaterThan(1.5);
    expect(c.duration).toBeLessThan(2.6);
    // The second sentence's first word sounds just after the sentence starts, its leading silence cut.
    expect(c.words).toHaveLength(4);
    expect(c.words![2].start).toBeCloseTo(c.starts![1] + 0.05, 1);
  });

  it("are not used when a sentence is missing or the clips cannot be decoded", async () => {
    server = serve(() => mp3());
    await store(sentence(passage.sentences[0]), sentenceClip());
    expect((await synthesize(passage)).source).toBe("api");
    await audioCache.clear();
    for (const text of passage.sentences) await store(sentence(text), new Blob([new Uint8Array(8)], { type: "audio/mpeg" }));
    expect((await synthesize(passage)).source).toBe("api");
    expect(server.generated()).toHaveLength(2);
  });
});

describe("garbled speech", () => {
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });
  const req = { text: "Write an evaluator.", voice: "v", engine: "omnivoice" };

  it("asks again when a take is mostly unvoiced noise", async () => {
    server = serve(replies(speech(noise()), speech(voice())));
    const c = await apiSynthesize(req);
    expect(server.generated()).toHaveLength(2);
    expect(c.voiced).toBeGreaterThan(GARBLED_BELOW);
  });

  it("keeps the best take after the retries run out", async () => {
    const takes = [noise(0.6, 1), mixed(0.03, 0.6), noise(0.6, 7)];
    const shares = takes.map((t) => voicedShare(t, RATE)!);
    expect(Math.max(...shares)).toBeLessThan(GARBLED_BELOW);
    server = serve(replies(...takes.map((t) => speech(t))));
    const c = await apiSynthesize({ ...req, text: "12" });
    expect(server.generated()).toHaveLength(3);
    expect(c.voiced).toBeCloseTo(Math.max(...shares));
    expect(c.voiced).toBe(shares[1]);
  });

  it("accepts a take that cannot be measured", async () => {
    server = serve(replies(undecodable()));
    const c = await apiSynthesize({ text: "Hello.", voice: "v", engine: "kittentts" });
    expect(server.generated()).toHaveLength(1);
    expect(c.voiced).toBeUndefined();
  });

  it("does not check or retry OpenAI speech", async () => {
    server = serve(replies(speech(noise())));
    const c = await apiSynthesize({ text: "Hello.", voice: "nova", engine: "openai" });
    expect(server.generated()).toHaveLength(1);
    expect(c.voiced).toBeUndefined();
  });

  it("generates again for a garbled clip cached before voicing was checked, and keeps the clean take", async () => {
    await store(req, noise());
    server = serve(replies(speech(voice())));
    expect((await synthesize(req)).source).toBe("api");
    expect(server.generated()).toHaveLength(1);
    expect((await saved(req))?.voiced).toBeGreaterThan(GARBLED_BELOW);
  });

  it("marks a clean clip cached before voicing was checked, without generating it again", async () => {
    await store(req, voice());
    expect((await synthesize(req)).source).toBe("cache");
    expect(server.sent).toEqual([]);
    expect((await saved(req))?.voiced).toBeGreaterThan(GARBLED_BELOW);
  });

  it("trusts a cached clip's earlier check instead of measuring it again", async () => {
    // Noise that was judged clean when it was saved: measuring it again would replace it.
    await store(req, noise(), { voiced: 0.6 });
    expect((await synthesize(req)).source).toBe("cache");
    expect(server.sent).toEqual([]);
  });

  it("replaces a garbled prepared clip with a fresh take", async () => {
    await preparedOnServer([req], () => speech(noise()), replies(speech(voice())));
    const c = await synthesize(req);
    expect(server.generated()).toHaveLength(1);
    expect(c.source).toBe("api");
    expect(c.voiced).toBeGreaterThan(GARBLED_BELOW);
  });
});
