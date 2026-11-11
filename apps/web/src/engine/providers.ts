import { audioCache } from "../lib/db";
import { hash } from "../lib/hash";
import { estimateDuration, splitWords } from "../lib/segment";
import { addUsage, isTokenSpeechModel } from "../lib/usage";
import { analyzeClip, clipVoicedShare, joinClips, measureDuration, proportionalStarts } from "./audio";
import { GARBLED_BELOW, GARBLED_RETRIES } from "./voicing";
import { readSpeechStream } from "./speechStream";
import { ApiBusy, ApiRejected, ApiUnreachable, LOCAL_ENGINE, type Chunk, type TtsRequest } from "./types";
import type { WordTiming } from "../lib/db";
import { OPENAI_ACCENTS, STEADY_NARRATION } from "../data/voices";
import { isBundledApp, isNativeApp } from "../lib/native";
import { resolveApiBase, speechEndpoint, withSpeechAuth } from "../lib/speechServer";
import { hasActivePreparation, prepareAudio, preparedAudio, type PreparationRequest, type PreparationStatus } from "./preparation";

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const API_KIND: "openai" | "readaloud" = (import.meta.env.VITE_TTS_PROVIDER as string | undefined) === "readaloud" ? "readaloud" : "openai";
export const DEFAULT_ENGINE: string = (import.meta.env.VITE_DEFAULT_ENGINE as string | undefined) || "kittentts";
export const OPENAI_BASE = ((import.meta.env.VITE_OPENAI_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const OPENAI_MODEL: string = (import.meta.env.VITE_OPENAI_TTS_MODEL as string | undefined) || "gpt-4o-mini-tts";
export const OPENAI_ENGINE = "openai";
export const FISH_ENGINE = "fish";
export const FISH_BASE = ((import.meta.env.VITE_FISH_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const FISH_MODEL = (import.meta.env.VITE_FISH_TTS_MODEL as string | undefined) || "s2.1-pro";
/** Base actually called. In the bundled iOS app a relative proxy is dropped unless Settings has an absolute server. */
export const activeApiBase = () => resolveApiBase(API_BASE, isBundledApp(), speechEndpoint().override);
export const activeOpenAIBase = () => resolveApiBase(OPENAI_BASE, isBundledApp());
export const activeFishBase = () => resolveApiBase(FISH_BASE, isBundledApp());
/** The Vite server on this origin. It also serves preparation, library, and auth routes. The bundled iOS app has none. */
export const usesBuiltInProxy = () => API_BASE === "/api/vs" && !isBundledApp();
export const hasApi = () => activeApiBase().length > 0;
export const hasOpenAI = () => activeOpenAIBase().length > 0;
export const hasFish = () => activeFishBase().length > 0;
export const hasSpeechApi = () => hasApi() || hasOpenAI() || hasFish();
/** Cloud engines that bill per request; nothing is generated for them ahead of need. */
export const isPaidEngine = (engine: string) => engine === OPENAI_ENGINE || engine === FISH_ENGINE;
/** Follows the narration prompt (steady delivery, accent voices). */
export const OPENAI_STEADY_MODEL = isTokenSpeechModel(OPENAI_MODEL) ? OPENAI_MODEL : "gpt-4o-mini-tts";
/** Billed by character, about a third less for ordinary reading, but ignores `instructions`. */
export const OPENAI_STANDARD_MODEL = "tts-1";
/** The OpenAI model a request goes to: accent voices need `instructions`, so they always use the steady model. */
export const openaiModelFor = (req: Pick<TtsRequest, "voice" | "openaiModel">) =>
  OPENAI_ACCENTS[req.voice] ? OPENAI_STEADY_MODEL : req.openaiModel || OPENAI_MODEL;
/** Which server an engine lives on. */
export const baseFor = (engine: string) => engine === FISH_ENGINE ? activeFishBase() : engine === OPENAI_ENGINE ? activeOpenAIBase() : activeApiBase();

/** OpenAI-style voice ids that VoiceStudio maps to the active engine's default voice. */
const OPENAI_ALIAS = /^(alloy|ash|ballad|cedar|coral|echo|fable|marin|nova|onyx|sage|shimmer|verse)$/;

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function parseWords(raw: unknown): Chunk["words"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((w) => (Array.isArray(w) ? { start: Number(w[0]), end: Number(w[1]) } : { start: Number((w as { start: number }).start), end: Number((w as { end: number }).end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  return out.length ? out : undefined;
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  const authed = withSpeechAuth(url, init);
  let r: Response;
  try {
    r = await fetch(url, authed);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiUnreachable();
  }
  // 404 on the route itself, gateway errors, and proxy failures all mean "no server"
  if (r.status === 404 || r.status === 408 || r.status >= 500) throw new ApiUnreachable(`HTTP ${r.status}`);
  if (r.status === 429) throw new ApiBusy(Number(r.headers.get("retry-after")) || 0);
  if (!r.ok) {
    let detail = "";
    try {
      const j = (await r.clone().json()) as { error?: { message?: string }; detail?: string | { message?: string }; message?: string };
      detail = j.error?.message || (typeof j.detail === "string" ? j.detail : j.detail?.message) || j.message || "";
    } catch {
      /* not json */
    }
    throw new ApiRejected(r.status, detail || (r.status === 401 || r.status === 403 ? "The speech server rejected the API key" : `Speech request failed (HTTP ${r.status})`));
  }
  return r;
}

/**
 * OpenAI-compatible speech API, as served by VoiceStudio at /v1/audio/speech.
 * Always requests 1× so cached clips play at any speed via the audio element.
 * Presets name their engine via `model`; cloned profiles use the active engine alias.
 */
export async function openaiSpeechSynthesize(req: TtsRequest & { profile?: boolean }): Promise<Chunk> {
  const base = baseFor(req.engine);
  if (!base) throw new ApiUnreachable("No API configured");
  if (req.profile) {
    const response = await doFetch(`${base}/engines`, { signal: req.signal });
    const capabilities = await response.json() as { tts: { active: string; backends: { id: string; supports_cloning?: boolean }[] } };
    const active = capabilities.tts.backends.find((e) => e.id === capabilities.tts.active);
    if (!active?.supports_cloning) throw new ApiRejected(409, "Select a cloning-capable engine in VoiceStudio to use saved voices. Using the browser voice for now.");
    if (capabilities.tts.active !== req.engine) throw new ApiRejected(409, "The VoiceStudio engine changed. Refresh Voices before playing this saved voice. Using the browser voice for now.");
  }
  const accent = req.engine === OPENAI_ENGINE ? OPENAI_ACCENTS[req.voice] : undefined;
  const model = req.engine === OPENAI_ENGINE ? openaiModelFor(req) : req.profile || OPENAI_ALIAS.test(req.voice) ? "tts-1" : req.engine;
  const steerable = req.engine === OPENAI_ENGINE && isTokenSpeechModel(model);
  const streamUsage = steerable;
  // Match VoiceStudio's normal 16-step setting. Its isolated Mac worker otherwise
  // falls through to the model's slower 32-step default.
  const omniVoice = req.engine === "omnivoice" || req.engine === "omnivoice-subprocess";
  // Only gpt-4o-mini-tts follows `instructions`; an accent voice adds its own on top of the steady delivery.
  const instructions = steerable ? (accent ? `${accent.instructions} ${STEADY_NARRATION}` : STEADY_NARRATION) : accent?.instructions;
  const r = await doFetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: streamUsage ? "text/event-stream, audio/mpeg" : "audio/mpeg, audio/*" },
    body: JSON.stringify({ model, input: req.text, voice: accent?.voice ?? req.voice, instructions, response_format: "mp3", speed: 1, ...(omniVoice ? { num_step: 16 } : {}), ...(streamUsage ? { stream_format: "sse" } : {}) }),
    signal: req.signal,
  });
  const streamed = r.headers.get("content-type")?.includes("text/event-stream") ? await readSpeechStream(r) : null;
  const blob = streamed?.audio ?? await r.blob();
  if (blob.size === 0) throw new ApiRejected(502, "Empty audio from the speech server");
  if (blob.type && !blob.type.startsWith("audio/") && blob.type !== "application/octet-stream") throw new ApiRejected(502, "Invalid audio from the speech server");
  const est = estimateDuration(splitWords(req.text));
  const mime = blob.type || r.headers.get("content-type") || "audio/mpeg";
  const duration = await measureDuration(blob, est);
  return { source: "api", audio: blob, mime, duration, ...(streamed?.tokens ? { tokens: streamed.tokens } : {}) };
}

/**
 * Legacy custom contract (VITE_TTS_PROVIDER=readaloud):
 *   POST {API_BASE}/tts  { text, voice, provider, format: "mp3" }
 *   → audio/mpeg with optional X-Duration / X-Word-Timings headers, or JSON { audio, mime, duration, words }.
 */
export async function readaloudSynthesize(req: TtsRequest): Promise<Chunk> {
  if (!hasApi()) throw new ApiUnreachable("No API configured");
  const r = await doFetch(`${activeApiBase()}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg, application/json" },
    body: JSON.stringify({ text: req.text, voice: req.voice, provider: req.engine, format: "mp3" }),
    signal: req.signal,
  });
  const ct = r.headers.get("content-type") ?? "";
  const est = estimateDuration(splitWords(req.text));
  if (ct.includes("json")) {
    const j = (await r.json()) as { audio: string; mime?: string; duration?: number; words?: unknown };
    const mime = j.mime ?? "audio/mpeg";
    return { source: "api", audio: b64ToBlob(j.audio, mime), mime, duration: Number(j.duration) || est, words: parseWords(j.words) };
  }
  const blob = await r.blob();
  const dur = Number(r.headers.get("x-duration"));
  let words: Chunk["words"];
  try {
    words = parseWords(JSON.parse(r.headers.get("x-word-timings") ?? "null"));
  } catch {
    words = undefined;
  }
  return { source: "api", audio: blob, mime: blob.type || "audio/mpeg", duration: dur > 0 ? dur : await measureDuration(blob, est), words };
}

export async function fishSynthesize(req: TtsRequest): Promise<Chunk> {
  if (!hasFish()) throw new ApiUnreachable("Fish Audio is not configured");
  const reference = req.voice.replace(/^fish:/, "");
  if (!reference) throw new ApiRejected(400, "Choose a Fish Audio voice");
  const r = await doFetch(`${activeFishBase()}/v1/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg", model: FISH_MODEL },
    body: JSON.stringify({ text: req.text, reference_id: reference, format: "mp3", prosody: { speed: 1 } }),
    signal: req.signal,
  });
  const blob = await r.blob();
  if (!blob.size || (blob.type && !blob.type.startsWith("audio/") && blob.type !== "application/octet-stream")) {
    throw new ApiRejected(502, "Fish Audio returned no playable audio");
  }
  const duration = await measureDuration(blob, estimateDuration(splitWords(req.text)));
  return { source: "api", audio: blob, mime: "audio/mpeg", duration };
}

export interface FishVoice {
  _id: string;
  title: string;
  languages?: string[];
  tags?: string[];
}

export async function fetchFishVoices(signal?: AbortSignal): Promise<FishVoice[]> {
  if (!hasFish()) return [];
  const r = await doFetch(`${activeFishBase()}/model?page_size=12&language=en&licensed=true&sort_by=score`, {
    signal, headers: { Accept: "application/json" },
  });
  const j = await r.json() as { items?: FishVoice[] };
  if (!Array.isArray(j.items)) throw new ApiRejected(502, "Fish Audio returned an invalid voice list");
  return j.items.filter((v) => typeof v._id === "string" && !!v._id && typeof v.title === "string");
}

const rawSynthesize = (req: TtsRequest & { profile?: boolean }) => {
  if (req.engine === FISH_ENGINE) return fishSynthesize(req);
  if (req.engine === OPENAI_ENGINE) return openaiSpeechSynthesize(req);
  return API_KIND === "readaloud" ? readaloudSynthesize(req) : openaiSpeechSynthesize(req);
};

/**
 * VoiceStudio runs one CPU worker and queues at most one more request; a third
 * concurrent request is refused with 429. The engine prefetches up to a minute
 * ahead, so speech requests are serialized here (one in flight) and a 429 from
 * another client is retried with backoff instead of falling back to the local voice.
 */
let chain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const abort = () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); };
    const t = setTimeout(() => { signal?.removeEventListener("abort", abort); res(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });

export const BUSY_RETRIES = 4;
/**
 * VoiceStudio answers a saturated pool with Retry-After: 30, sized for batch
 * clients. Someone listening cannot wait minutes: the web server pauses its own
 * preparation as soon as a live request arrives, so the pool frees within one
 * passage and a short retry is enough.
 */
export const BUSY_RETRY_CAP_MS = 5000;

/** Whether a clip from this engine is checked for garbled speech; paid engines have not shown the failure. */
const checksVoicing = (engine: string) => engine !== OPENAI_ENGINE && engine !== FISH_ENGINE;

/** True when a clip's measured voicing marks it as a failed render; unmeasured clips pass. */
export const garbled = (voiced: number | undefined) => voiced !== undefined && voiced < GARBLED_BELOW;

export function apiSynthesize(req: TtsRequest & { profile?: boolean }): Promise<Chunk> {
  const run = async () => {
    let best: Chunk | undefined;
    for (let busy = 0, retakes = 0; ;) {
      if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const started = Date.now();
        const chunk = await rawSynthesize(req);
        if (!chunk.audio?.size) throw new ApiRejected(502, "Empty audio from the speech server");
        chunk.renderSeconds = (Date.now() - started) / 1000;
        await addUsage({ engine: req.engine, model: req.engine === OPENAI_ENGINE ? openaiModelFor(req) : req.engine === FISH_ENGINE ? FISH_MODEL : req.engine,
          text: req.text, audioSeconds: chunk.duration, tokens: chunk.tokens, docId: req.docId });
        if (!checksVoicing(req.engine)) return chunk;
        chunk.voiced = await clipVoicedShare(chunk.audio);
        if (!garbled(chunk.voiced)) return chunk;
        if (!best || chunk.voiced! > best.voiced!) best = chunk;
        if (retakes >= GARBLED_RETRIES) return best;
        retakes++;
        console.warn(`Speech came back garbled (voiced ${chunk.voiced!.toFixed(2)}); asking again: ${req.text.slice(0, 60)}`);
      } catch (e) {
        if (!(e instanceof ApiBusy) || busy >= BUSY_RETRIES) throw e;
        await sleep(Math.min(e.retryAfterMs || 400 * 2 ** busy, BUSY_RETRY_CAP_MS), req.signal);
        busy++;
      }
    }
  };
  // OpenAI handles concurrency; only the single-worker local server is serialized.
  if (req.engine === OPENAI_ENGINE || req.engine === FISH_ENGINE) return run();
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/**
 * Cache key: engine + voice + text. Switching engines never replays another engine's audio.
 * OpenAI's steady model keeps the plain engine key that its clips were cached under before the model could change.
 */
export function cacheKey(req: Pick<TtsRequest, "text" | "voice" | "engine" | "openaiModel">): string {
  const openai = req.engine === OPENAI_ENGINE ? openaiModelFor(req) : "";
  const engine = req.engine === FISH_ENGINE ? `${FISH_ENGINE}:${FISH_MODEL}` : openai && !isTokenSpeechModel(openai) ? `${OPENAI_ENGINE}:${openai}` : req.engine;
  return `${engine}|${req.voice}|${hash(req.text)}`;
}

export async function fromCache(req: TtsRequest): Promise<Chunk | null> {
  try {
    const rec = await audioCache.get(cacheKey(req));
    if (!rec) return null;
    return { source: "cache", audio: rec.blob, mime: rec.mime, duration: rec.duration, words: rec.words, starts: rec.starts, lead: rec.lead, tail: rec.tail, loudness: rec.loudness, voiced: rec.voiced };
  } catch {
    return null;
  }
}

export async function toCache(req: TtsRequest, chunk: Chunk) {
  if (!chunk.audio) return;
  try {
    await audioCache.put({
      key: cacheKey(req), blob: chunk.audio, mime: chunk.mime ?? "audio/mpeg", duration: chunk.duration, words: chunk.words,
      starts: chunk.starts, lead: chunk.lead, tail: chunk.tail, loudness: chunk.loudness, voiced: chunk.voiced, createdAt: Date.now(),
    });
  } catch {
    /* quota or private mode: ignore */
  }
}

/** Local voice: the browser's speech engine (or pure timing when there is none). Spoken sentence by sentence, so each part keeps its own estimate. */
export function localChunk(text: string, parts?: string[][]): Chunk {
  const webSpeech = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  // The iOS shell speaks with AVSpeechSynthesizer even when WKWebView has no Web Speech API.
  const supported = webSpeech || isNativeApp();
  const source = supported ? "local" : "estimate";
  if (!parts || parts.length <= 1) return { source, duration: estimateDuration(splitWords(text)) };
  const starts: number[] = [];
  let acc = 0;
  for (const words of parts) {
    starts.push(acc);
    acc += estimateDuration(words);
  }
  return { source, duration: acc, starts };
}

/** Sentence starts from word timings: the first word of each sentence, a hair early so the highlight leads the voice. */
export function startsFromWords(words: WordTiming[], parts: string[][]): number[] | null {
  const starts = [0];
  let i = 0;
  for (let k = 0; k < parts.length - 1; k++) {
    i += parts[k].length;
    const w = words[i];
    if (!w) return null;
    starts.push(Math.max(starts[k], w.start - 0.03));
  }
  return starts;
}

/**
 * A passage clip plays as one file while the reader follows sentence by sentence,
 * so playback needs each sentence's start inside the clip, plus the clip's level
 * and edge silences for joining it to its neighbours. Clips written before this
 * existed carry none of it and are inspected on the way out of the cache.
 */
async function locateSentences(chunk: Chunk, parts: string[][] | undefined): Promise<Chunk> {
  if (!chunk.audio) return chunk;
  const partWords = parts?.map((p) => p.length) ?? [];
  const multi = partWords.length > 1;
  const fromWords = multi && chunk.words && parts ? startsFromWords(chunk.words, parts) : null;
  if (fromWords) chunk.starts = fromWords;
  if (chunk.loudness !== undefined && (!multi || chunk.starts)) return chunk;
  const a = await analyzeClip(chunk.audio, chunk.duration, multi ? partWords : [1]);
  if (a.duration > 0) chunk.duration = a.duration;
  chunk.lead = a.lead;
  chunk.tail = a.tail;
  chunk.loudness = a.loudness;
  if (multi && !chunk.starts) chunk.starts = a.starts.length === partWords.length ? a.starts : proportionalStarts(chunk.duration, partWords);
  return chunk;
}

export interface SynthOptions extends TtsRequest {
  /** Phase 4: ask the server for word timings after synthesis (one extra request per passage) */
  wordTimings?: boolean;
  /** Every word of the text, in order, for alignment */
  words?: string[];
  /** The words of each sentence in the text, when it holds more than one; playback follows them inside the clip */
  parts?: string[][];
  /** The text of each sentence, matching `parts`; lets a passage reuse clips cached sentence by sentence */
  sentences?: string[];
  /** Cloned profile voice (sent with the active-engine alias) */
  profile?: boolean;
  /**
   * When false, a failed generation throws instead of quietly reading with the browser voice.
   * Falls back anyway when no server is configured for the engine (there is nothing to retry).
   */
  fallbackLocal?: boolean;
  /** When true the API is skipped (local engine chosen, local voice, or we are known to be offline) */
  forceLocal?: boolean;
  onOffline?: () => void;
  onOnline?: () => void;
  onRejected?: (message: string) => void;
}

export const preparationRequests = (requests: SynthOptions[]): PreparationRequest[] => requests.map((r) => ({ key: cacheKey(r), text: r.text, voice: r.voice, engine: r.engine, profile: r.profile, protocol: API_KIND }));

export async function prepareInBackground(requests: SynthOptions[], start: number, progress?: (done: number, total: number, status?: PreparationStatus) => void, signal?: AbortSignal) {
  if (!usesBuiltInProxy()) throw new Error("Background preparation needs the built-in /api/vs connection.");
  const items = preparationRequests(requests);
  await Promise.all(items.map(async (item, index) => { item.cached = !!await fromCache(requests[index]); }));
  signal?.throwIfAborted();
  if (items.every((item) => item.cached) && !hasActivePreparation(items)) {
    progress?.(items.length, items.length);
    return;
  }
  return prepareAudio(items, start, progress, signal);
}

/**
 * Before passages, every sentence was its own request and clip. When each sentence
 * of a passage is still cached that way, the clips are joined instead of paying for
 * the passage again. The join is not cached: it is cheap to redo and much larger as PCM.
 */
export async function fromSentenceClips(opts: SynthOptions): Promise<Chunk | null> {
  const texts = opts.sentences;
  if (!texts || texts.length < 2) return null;
  const clips: Chunk[] = [];
  for (const text of texts) {
    const c = await fromCache({ ...opts, text });
    if (!c?.audio) return null;
    clips.push(c);
  }
  const joined = await joinClips(clips.map((c) => c.audio!));
  if (!joined) return null;
  const words = clips.every((c) => c.words?.length)
    ? clips.flatMap((c, k) => c.words!.map((w) => ({ start: w.start - joined.trims[k] + joined.starts[k], end: w.end - joined.trims[k] + joined.starts[k] })))
    : undefined;
  return { source: "cache", audio: joined.audio, mime: joined.audio.type, duration: joined.duration, starts: joined.starts, lead: joined.lead, tail: joined.tail, loudness: joined.loudness, words };
}

/** Cache → sentence clips already paid for → API → local fallback. */
export async function synthesize(opts: SynthOptions): Promise<Chunk> {
  if (opts.forceLocal || opts.engine === LOCAL_ENGINE) return localChunk(opts.text, opts.parts);
  const cached = await fromCache(opts);
  // Clips stored before voicing was checked are judged once on the way out; a garbled one is generated again.
  if (cached && checksVoicing(opts.engine) && cached.voiced === undefined && cached.audio) {
    cached.voiced = await clipVoicedShare(cached.audio);
    if (!garbled(cached.voiced)) {
      await locateSentences(cached, opts.parts);
      if (cached.voiced !== undefined) await toCache(opts, cached);
      return cached;
    }
  } else if (cached) return locateSentences(cached, opts.parts);
  const reused = await fromSentenceClips(opts);
  if (reused) return reused;
  try {
    const prepared = !isPaidEngine(opts.engine) && usesBuiltInProxy() ? await preparedAudio(cacheKey(opts), opts.signal) : null;
    let chunk: Chunk;
    if (prepared) {
      // Feed stored responses through the same parsers as fresh speech, including
      // the legacy JSON contract, without issuing another synthesis request.
      chunk = await preparedChunk(prepared, opts);
      // The web server checks what it prepares; this catches clips it stored before it did.
      if (checksVoicing(opts.engine) && chunk.audio) {
        chunk.voiced = await clipVoicedShare(chunk.audio);
        if (garbled(chunk.voiced)) chunk = await apiSynthesize(opts);
      }
    } else {
      chunk = await apiSynthesize(opts);
    }
    opts.onOnline?.();
    if (opts.wordTimings && chunk.audio && opts.words?.length) {
      try {
        chunk.words = (await fetchWordTimings(chunk.audio, opts.words, opts.signal)) ?? undefined;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        /* timings are optional: keep the estimate */
      }
    }
    await locateSentences(chunk, opts.parts);
    await toCache(opts, chunk);
    return chunk;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (opts.fallbackLocal === false && baseFor(opts.engine)) throw e;
    if (e instanceof ApiUnreachable) opts.onOffline?.();
    else if (e instanceof ApiRejected) opts.onRejected?.(e.message);
    else if (e instanceof ApiBusy) opts.onRejected?.("The speech server is busy; this passage uses the browser voice");
    return localChunk(opts.text, opts.parts);
  }
}

async function preparedChunk(response: Response, req: TtsRequest): Promise<Chunk> {
  const estimate = estimateDuration(splitWords(req.text));
  if (response.headers.get("content-type")?.includes("json")) {
    const data = await response.json() as { audio: string; mime?: string; duration?: number; words?: unknown };
    const mime = data.mime || "audio/mpeg";
    return { source: "cache", audio: b64ToBlob(data.audio, mime), mime, duration: data.duration || estimate, words: parseWords(data.words) };
  }
  const audio = await response.blob();
  let words: WordTiming[] | undefined;
  try { words = parseWords(JSON.parse(response.headers.get("x-word-timings") || "null")); } catch { /* optional */ }
  return { source: "cache", audio, mime: audio.type || "audio/mpeg", duration: Number(response.headers.get("x-duration")) || await measureDuration(audio, estimate), words };
}

/**
 * Phase 4: word timings from the transcription endpoint (OpenAI shape, verbose_json + word granularity).
 * Returns timings only when every sentence word gets one; otherwise null so the estimate stays in use.
 */
export async function fetchWordTimings(audio: Blob, words: string[], signal?: AbortSignal): Promise<WordTiming[] | null> {
  if (!hasApi() || API_KIND !== "openai" || !words.length) return null;
  const form = new FormData();
  form.append("file", audio, "passage.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const r = await doFetch(`${activeApiBase()}/v1/audio/transcriptions`, { method: "POST", body: form, signal, headers: { "x-stub-text": encodeURIComponent(words.join(" ")) } });
  const j = (await r.json()) as { words?: { word: string; start: number; end: number }[] };
  const got = (j.words ?? []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  return alignWords(got, words);
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Align transcript words to the text's words. Exact count match or a clean token match wins; anything else is rejected. */
export function alignWords(got: { word: string; start: number; end: number }[], words: string[]): WordTiming[] | null {
  if (!got.length) return null;
  if (got.length === words.length) return got.map((w) => ({ start: w.start, end: w.end }));
  // Transcripts sometimes split or merge tokens: walk both lists by normalized text.
  const out: WordTiming[] = [];
  let gi = 0;
  for (const w of words) {
    const target = norm(w);
    if (!target) {
      out.push(out.length ? { ...out[out.length - 1] } : { start: 0, end: 0 });
      continue;
    }
    let acc = "", start = -1, end = 0;
    while (gi < got.length && acc.length < target.length) {
      const g = got[gi++];
      if (start < 0) start = g.start;
      end = g.end;
      acc += norm(g.word);
    }
    if (acc !== target) return null;
    out.push({ start, end });
  }
  return out.length === words.length ? out : null;
}

/** Server-reported voices and engines (VoiceStudio extension GET /v1/audio/voices). */
export interface ServerVoice {
  id: string;
  name: string;
  type: "profile" | "openai_alias" | string;
  language?: string | null;
}
export interface ServerEngine {
  id: string;
  name?: string;
  available?: boolean;
  supports_cloning?: boolean;
}

export async function fetchServerVoices(signal?: AbortSignal): Promise<{ voices: ServerVoice[]; engines: ServerEngine[] }> {
  if (!hasApi() || API_KIND !== "openai") return { voices: [], engines: [] };
  const r = await doFetch(`${activeApiBase()}/v1/audio/voices`, { signal, headers: { Accept: "application/json" } });
  const j = (await r.json()) as { voices?: ServerVoice[]; engines?: ServerEngine[] };
  return { voices: (j.voices ?? []).map((v) => ({ ...v, id: v.id ?? (v as { voice_id?: string }).voice_id ?? "" })).filter((v) => v.id), engines: j.engines ?? [] };
}
