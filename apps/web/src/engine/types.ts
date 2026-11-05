import type { WordTiming } from "../lib/db";

export type ProviderId = "auto" | "openai" | "elevenlabs" | "piper";
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
  provider: ProviderId;
  signal?: AbortSignal;
}

export class ApiUnreachable extends Error {
  constructor(msg = "API unreachable") {
    super(msg);
    this.name = "ApiUnreachable";
  }
}
