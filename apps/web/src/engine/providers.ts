import { audioCache } from "../lib/db";
import { hash } from "../lib/hash";
import { estimateDuration, splitWords } from "../lib/segment";
import { addUsage } from "../lib/usage";
import { ApiUnreachable, type Chunk, type TtsRequest } from "./types";

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
export const hasApi = () => API_BASE.length > 0;

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

/**
 * Cloud TTS. Contract:
 *   POST {API_BASE}/tts  { text, voice, provider, format: "mp3" }
 *   → audio/mpeg body with optional headers X-Duration (seconds) and X-Word-Timings (JSON [[start,end],…])
 *   → or application/json { audio: base64, mime, duration, words: [{start,end}] }
 */
export async function apiSynthesize(req: TtsRequest): Promise<Chunk> {
  if (!hasApi()) throw new ApiUnreachable("No API configured");
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg, application/json" },
      body: JSON.stringify({ text: req.text, voice: req.voice, provider: req.provider, format: "mp3" }),
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiUnreachable();
  }
  if (r.status >= 500 || r.status === 404) throw new ApiUnreachable(`HTTP ${r.status}`);
  if (!r.ok) throw new Error(`TTS failed: HTTP ${r.status}`);
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
  return { source: "api", audio: blob, mime: blob.type || "audio/mpeg", duration: dur > 0 ? dur : est, words };
}

export function cacheKey(req: Pick<TtsRequest, "text" | "voice" | "provider">): string {
  return `${req.voice}|${req.provider}|${hash(req.text)}`;
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
  /** When true the API is skipped (user chose Piper, or we are known to be offline) */
  forceLocal?: boolean;
  onOffline?: () => void;
  onOnline?: () => void;
}

/** Cache → API → local fallback. */
export async function synthesize(opts: SynthOptions): Promise<Chunk> {
  if (opts.forceLocal || opts.provider === "piper") return localChunk(opts.text);
  const cached = await fromCache(opts);
  if (cached) return cached;
  try {
    const chunk = await apiSynthesize(opts);
    opts.onOnline?.();
    addUsage(opts.text.length);
    void toCache(opts, chunk);
    return chunk;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (e instanceof ApiUnreachable) opts.onOffline?.();
    return localChunk(opts.text);
  }
}
