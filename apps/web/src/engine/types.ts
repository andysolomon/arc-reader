import type { WordTiming } from "../lib/db";
import type { TokenUsage } from "../lib/usage";

/** Legacy custom-contract provider hint (only used when VITE_TTS_PROVIDER=readaloud). */
export type ProviderId = "auto" | "openai" | "elevenlabs" | "piper";
/** TTS engine id as listed by the speech server, or "local" for the browser voice. */
export type EngineId = string;
export const LOCAL_ENGINE: EngineId = "local";

export type ChunkSource = "api" | "cache" | "local" | "estimate";

export interface Chunk {
  source: ChunkSource;
  /** Audio bytes when a cloud/cached voice produced them */
  audio?: Blob;
  mime?: string;
  /** Duration in seconds at 1× */
  duration: number;
  /** Word timings at 1×, when the provider has them (clip time, across every sentence in the clip) */
  words?: WordTiming[];
  /** Where each sentence of the passage starts inside the clip, in seconds; `starts[0]` is 0. Absent for one-sentence clips. */
  starts?: number[];
  /** Silence before the first and after the last voiced frame, in seconds. */
  lead?: number;
  tail?: number;
  /** RMS level of the voiced frames in dBFS, for level matching between clips. */
  loudness?: number;
  /** Share of the clip's energy in voiced frames (see voicing.ts); low means a garbled render. Undefined when not measured. */
  voiced?: number;
  /** Reported by the provider for a new generation; never reused from cache. */
  tokens?: TokenUsage;
  /** Wall-clock seconds the server took to generate this chunk (new generations only, queue wait excluded). */
  renderSeconds?: number;
}

export interface TtsRequest {
  text: string;
  voice: string;
  engine: EngineId;
  /** OpenAI model for the reading voice (see openaiModelFor); other engines ignore it. */
  openaiModel?: string;
  /** Library document being read, for per-document spend on paid voices */
  docId?: string;
  signal?: AbortSignal;
}

export class ApiUnreachable extends Error {
  constructor(msg = "API unreachable") {
    super(msg);
    this.name = "ApiUnreachable";
  }
}

/** 429: the server's worker pool is saturated. Retried by the adapter. */
export class ApiBusy extends Error {
  retryAfterMs: number;
  constructor(retryAfterSeconds = 0) {
    super("Speech server busy");
    this.name = "ApiBusy";
    this.retryAfterMs = retryAfterSeconds * 1000;
  }
}

export class ApiRejected extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
    this.name = "ApiRejected";
  }
}
