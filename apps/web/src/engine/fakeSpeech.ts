/**
 * Test-only stand-ins for what sits outside the speech engine: the network (`fetch`)
 * and the browser (localStorage, an AudioContext that decodes WAV). Everything inside
 * the engine — the IndexedDB audio cache, the usage ledger, preparation, decoding and
 * voicing checks — runs for real, so tests read results back the way the app does.
 */
import "fake-indexeddb/auto";
import { vi } from "vitest";
import { encodeWav } from "./audio";

export const RATE = 16_000;

/** Syllable-like bursts of a 140 Hz voice with harmonics: measured as clean speech. */
export function voice(seconds = 0.6): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
    out[i] = 0.2 * Math.sin(Math.PI * ((t * 4) % 1)) ** 2 * v;
  }
  return out;
}

/** Breathy noise with the same envelope: how OmniVoice's failed renders measure. */
export function noise(seconds = 0.6, seed = 1): Float32Array {
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = 0.2 * Math.sin(Math.PI * (((i / RATE) * 4) % 1)) ** 2 * random();
  return out;
}

/** Voiced and noisy halves: a take whose voiced share sits between the two. */
export function mixed(voicedSeconds: number, noiseSeconds: number): Float32Array {
  const a = voice(voicedSeconds), b = noise(noiseSeconds);
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** A speech reply, as a speech server sends it. */
export const speech = (samples: Float32Array = voice(), headers: Record<string, string> = {}) =>
  new Response(encodeWav(samples, RATE), { headers: { "content-type": "audio/wav", ...headers } });

/** Bytes no decoder can read but that still look like audio, as from a server whose clips the browser can't decode. */
export const undecodable = () => new Response(new Blob([new Uint8Array(64)], { type: "audio/mpeg" }), { headers: { "content-type": "audio/mpeg" } });

/** Decodes 16-bit mono PCM WAV, the format `speech()` sends; anything else fails as a browser would. */
class WavAudioContext {
  async decodeAudioData(data: ArrayBuffer) {
    const view = new DataView(data);
    const tag = (at: number) => String.fromCharCode(...new Uint8Array(data, at, 4));
    if (data.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new DOMException("Unable to decode audio data", "EncodingError");
    const sampleRate = view.getUint32(24, true);
    const samples = new Float32Array(view.getUint32(40, true) / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 0x8000;
    return { sampleRate, length: samples.length, duration: samples.length / sampleRate, numberOfChannels: 1, getChannelData: () => samples };
  }
}

/** A browser page for the engine: storage that starts empty and audio decoding. */
export function installBrowser() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { AudioContext: WavAudioContext }));
  return { clearStorage: () => values.clear() };
}

export interface Sent {
  url: string;
  method: string;
  headers: Headers;
  /** Parsed JSON body, or the raw body when it isn't JSON. */
  body: unknown;
  signal?: AbortSignal | null;
}

/** Answer every request with `handler`, recording what was sent. A request with an aborted signal fails as fetch does. */
export function serve(handler: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
    let body: unknown = init.body;
    if (typeof body === "string") try { body = JSON.parse(body); } catch { /* not JSON */ }
    const request = { url: String(input), method: init.method ?? "GET", headers: new Headers(init.headers), body, signal: init.signal };
    sent.push(request);
    return handler(request);
  });
  return {
    sent,
    /** Speech generation requests: the ones that cost money or a GPU's time. */
    generated: () => sent.filter((s) => /\/v1\/audio\/speech$|\/v1\/tts$/.test(s.url)),
  };
}

/** Answers the given responses in order, then fails the test loudly if asked for more. */
export function replies(...responses: (Response | Error | (() => Response))[]) {
  return () => {
    const next = responses.shift();
    if (!next) throw new Error("The fake server got a request the test did not expect");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
}
