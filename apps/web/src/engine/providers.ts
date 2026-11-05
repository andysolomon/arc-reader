import { audioCache } from "../lib/db";
import { hash } from "../lib/hash";
import { estimateDuration, splitWords } from "../lib/segment";
import { addUsage } from "../lib/usage";
import { measureDuration } from "./audio";
import { ApiRejected, ApiUnreachable, LOCAL_ENGINE, type Chunk, type TtsRequest } from "./types";
import type { WordTiming } from "../lib/db";

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const API_KIND: "openai" | "readaloud" = (import.meta.env.VITE_TTS_PROVIDER as string | undefined) === "readaloud" ? "readaloud" : "openai";
export const DEFAULT_ENGINE: string = (import.meta.env.VITE_DEFAULT_ENGINE as string | undefined) || "kittentts";
export const hasApi = () => API_BASE.length > 0;

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
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiUnreachable();
  }
  // 404 on the route itself, gateway errors, and proxy failures all mean "no server"
  if (r.status === 404 || r.status === 408 || r.status >= 500) throw new ApiUnreachable(`HTTP ${r.status}`);
  if (r.status === 401 || r.status === 403) throw new ApiRejected(r.status, "The speech server rejected the API key");
  if (!r.ok) {
    let detail = "";
    try {
      const j = (await r.clone().json()) as { error?: { message?: string }; detail?: string };
      detail = j.error?.message || j.detail || "";
    } catch {
      /* not json */
    }
    throw new ApiRejected(r.status, detail || `Speech request failed (HTTP ${r.status})`);
  }
  return r;
}

/**
 * OpenAI-compatible speech API, as served by VoiceStudio at /v1/audio/speech.
 * Always requests 1× so cached clips play at any speed via the audio element.
 * Presets name their engine via `model`; cloned profiles use the active engine alias.
 */
export async function openaiSpeechSynthesize(req: TtsRequest & { profile?: boolean }): Promise<Chunk> {
  if (!hasApi()) throw new ApiUnreachable("No API configured");
  const model = req.profile || OPENAI_ALIAS.test(req.voice) ? "tts-1" : req.engine;
  const r = await doFetch(`${API_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg, audio/*" },
    body: JSON.stringify({ model, input: req.text, voice: req.voice, response_format: "mp3", speed: 1 }),
    signal: req.signal,
  });
  const blob = await r.blob();
  if (blob.size === 0) throw new ApiRejected(502, "Empty audio from the speech server");
  const est = estimateDuration(splitWords(req.text));
  const mime = blob.type || r.headers.get("content-type") || "audio/mpeg";
  const duration = await measureDuration(blob, est);
  return { source: "api", audio: blob, mime, duration };
}

/**
 * Legacy custom contract (VITE_TTS_PROVIDER=readaloud):
 *   POST {API_BASE}/tts  { text, voice, provider, format: "mp3" }
 *   → audio/mpeg with optional X-Duration / X-Word-Timings headers, or JSON { audio, mime, duration, words }.
 */
export async function readaloudSynthesize(req: TtsRequest): Promise<Chunk> {
  if (!hasApi()) throw new ApiUnreachable("No API configured");
  const r = await doFetch(`${API_BASE}/tts`, {
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

export const apiSynthesize = (req: TtsRequest & { profile?: boolean }) => (API_KIND === "readaloud" ? readaloudSynthesize(req) : openaiSpeechSynthesize(req));

/** Cache key: engine + voice + text. Switching engines never replays another engine's audio. */
export function cacheKey(req: Pick<TtsRequest, "text" | "voice" | "engine">): string {
  return `${req.engine}|${req.voice}|${hash(req.text)}`;
}

export async function fromCache(req: TtsRequest): Promise<Chunk | null> {
  try {
    const rec = await audioCache.get(cacheKey(req));
    if (!rec) return null;
    return { source: "cache", audio: rec.blob, mime: rec.mime, duration: rec.duration, words: rec.words };
  } catch {
    return null;
  }
}

export async function toCache(req: TtsRequest, chunk: Chunk) {
  if (!chunk.audio) return;
  try {
    await audioCache.put({ key: cacheKey(req), blob: chunk.audio, mime: chunk.mime ?? "audio/mpeg", duration: chunk.duration, words: chunk.words, createdAt: Date.now() });
  } catch {
    /* quota or private mode: ignore */
  }
}

/** Local voice: the browser's speech engine (or pure timing when there is none). */
export function localChunk(text: string): Chunk {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  return { source: supported ? "local" : "estimate", duration: estimateDuration(splitWords(text)) };
}

export interface SynthOptions extends TtsRequest {
  /** Phase 4: ask the server for word timings after synthesis (one extra request per sentence) */
  wordTimings?: boolean;
  /** The sentence's words, for alignment */
  words?: string[];
  /** Cloned profile voice (sent with the active-engine alias) */
  profile?: boolean;
  /** When true the API is skipped (local engine chosen, local voice, or we are known to be offline) */
  forceLocal?: boolean;
  onOffline?: () => void;
  onOnline?: () => void;
  onRejected?: (message: string) => void;
}

/** Cache → API → local fallback. */
export async function synthesize(opts: SynthOptions): Promise<Chunk> {
  if (opts.forceLocal || opts.engine === LOCAL_ENGINE) return localChunk(opts.text);
  const cached = await fromCache(opts);
  if (cached) return cached;
  try {
    const chunk = await apiSynthesize(opts);
    opts.onOnline?.();
    addUsage(opts.text.length);
    if (opts.wordTimings && chunk.audio && opts.words?.length) {
      try {
        chunk.words = (await fetchWordTimings(chunk.audio, opts.words, opts.signal)) ?? undefined;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        /* timings are optional: keep the estimate */
      }
    }
    void toCache(opts, chunk);
    return chunk;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (e instanceof ApiUnreachable) opts.onOffline?.();
    else if (e instanceof ApiRejected) opts.onRejected?.(e.message);
    return localChunk(opts.text);
  }
}

/**
 * Phase 4: word timings from the transcription endpoint (OpenAI shape, verbose_json + word granularity).
 * Returns timings only when every sentence word gets one; otherwise null so the estimate stays in use.
 */
export async function fetchWordTimings(audio: Blob, words: string[], signal?: AbortSignal): Promise<WordTiming[] | null> {
  if (!hasApi() || API_KIND !== "openai" || !words.length) return null;
  const form = new FormData();
  form.append("file", audio, "sentence.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const r = await doFetch(`${API_BASE}/v1/audio/transcriptions`, { method: "POST", body: form, signal, headers: { "x-stub-text": encodeURIComponent(words.join(" ")) } });
  const j = (await r.json()) as { words?: { word: string; start: number; end: number }[] };
  const got = (j.words ?? []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  return alignWords(got, words);
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Align transcript words to the sentence's words. Exact count match or a clean token match wins; anything else is rejected. */
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
}

export async function fetchServerVoices(signal?: AbortSignal): Promise<{ voices: ServerVoice[]; engines: ServerEngine[] }> {
  if (!hasApi() || API_KIND !== "openai") return { voices: [], engines: [] };
  const r = await doFetch(`${API_BASE}/v1/audio/voices`, { signal, headers: { Accept: "application/json" } });
  const j = (await r.json()) as { voices?: ServerVoice[]; engines?: ServerEngine[] };
  return { voices: (j.voices ?? []).map((v) => ({ ...v, id: v.id ?? (v as { voice_id?: string }).voice_id ?? "" })).filter((v) => v.id), engines: j.engines ?? [] };
}
