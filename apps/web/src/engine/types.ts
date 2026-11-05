import type { WordTiming } from "../lib/db";

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
  /** Word timings at 1×, when the provider has them */
  words?: WordTiming[];
}

export interface TtsRequest {
  text: string;
  voice: string;
  engine: EngineId;
  signal?: AbortSignal;
}

export class ApiUnreachable extends Error {
  constructor(msg = "API unreachable") {
    super(msg);
    this.name = "ApiUnreachable";
  }
}

export class ApiRejected extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
    this.name = "ApiRejected";
  }
}
