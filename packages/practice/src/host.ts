import type { RequestOptions } from "./request";

/**
 * What the engine needs from the app it runs in. ReadAloud and Cadence each call
 * `configurePractice` once, before anything is read aloud; the defaults suit an app served at
 * the root of a ReadAloud server, speaking with the browser's own voice.
 */
export interface PracticeHost {
  /** Root of the ReadAloud server's API routes: "/api", or under a path when the app is served from one. */
  api: string;
  /** A request to the speech server for `path` (such as "/transcribe"): where it goes, and how it is authorised. */
  speechRequest: (path: string, init: RequestOptions) => { url: string; init: RequestOptions };
  /**
   * Speech for `text` in the app's voice. A clip with no audio has the browser's own voice say
   * the text in `lang`. The clip rejects with a message to show.
   */
  synthesize: (text: string, signal?: AbortSignal) => { clip: Promise<{ audio?: Blob | null }>; lang: string };
  /** A passage as the pieces to speak, one clip each, so the first is not long in coming. */
  speechPieces: (text: string) => string[];
}

/** About 20 seconds of speech. */
const PIECE_MAX_WORDS = 60;

/** Whole sentences in roughly equal shares of at most PIECE_MAX_WORDS words. */
export function sentencePieces(text: string, maxWords = PIECE_MAX_WORDS): string[] {
  const sentences = text.split(/(?<=[.!?]["”’)]*)\s+/).map((s) => s.trim()).filter(Boolean);
  const count = (s: string) => s.split(/\s+/).length;
  const total = sentences.reduce((n, s) => n + count(s), 0);
  const target = total / Math.max(1, Math.ceil(total / maxWords));
  const out: string[] = [];
  let run: string[] = [], words = 0;
  for (const sentence of sentences) {
    const n = count(sentence);
    if (words > 0 && (words >= target || words + n > maxWords)) { out.push(run.join(" ")); run = []; words = 0; }
    run.push(sentence); words += n;
  }
  if (run.length) out.push(run.join(" "));
  return out;
}

let host: PracticeHost = {
  api: "/api",
  speechRequest: (path, init) => ({ url: `${host.api}/vs${path}`, init }),
  synthesize: () => ({ clip: Promise.resolve({ audio: null }), lang: "en-US" }),
  speechPieces: sentencePieces,
};

export const practiceHost = (): PracticeHost => host;

export function configurePractice(next: Partial<PracticeHost>): void {
  host = { ...host, ...next };
}
