import type { DocRecord } from "./db";

/**
 * What is said in the video on an X post, added to the post's document as text.
 * The server does the work (vite.transcribe.ts); this is what the two sides share.
 */

const X_HOSTS = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i;

/** The status id of an x.com / twitter.com post link, or null for anything else. */
export function xPostId(url: URL): string | null {
  if (!X_HOSTS.test(url.hostname)) return null;
  return url.pathname.match(/^\/(?:[\w]+|i(?:\/web)?)\/status(?:es)?\/(\d+)/)?.[1] ?? null;
}

/** Whether a document came from an X post, the only pages whose videos can be transcribed. */
export function isXPost(url: string | undefined): boolean {
  try { return !!url && xPostId(new URL(url)) !== null; } catch { return false; }
}

export interface TranscriptStatus {
  /**
   * `none`: nothing has been asked for. `waiting`: another video is ahead of this one.
   * `fetching`: getting the video's sound. `transcribing`, `done`, `failed`.
   */
  state: "none" | "waiting" | "fetching" | "transcribing" | "done" | "failed";
  /** Length of the post's video; absent when it has none that can be transcribed */
  seconds?: number;
  /** Seconds of it transcribed so far */
  done?: number;
  /** What is said, in paragraphs, once done */
  text?: string;
  error?: string;
}

/** "36 minutes", "1 hour 5 minutes", "40 seconds". */
export function videoLength(seconds: number): string {
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds < 60) return count(Math.max(1, Math.round(seconds)), "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return count(minutes, "minute");
  return minutes % 60 ? `${count(Math.floor(minutes / 60), "hour")} ${count(minutes % 60, "minute")}` : count(minutes / 60, "hour");
}

export const TRANSCRIPT_HEADING = "## Transcript";

/** The document with the video's words after the post's own, under a heading that is read out. */
export function withTranscript(rec: DocRecord, transcript: string, seconds: number, now = Date.now()): DocRecord {
  const text = [rec.text.trim(), TRANSCRIPT_HEADING, transcript.trim()].filter(Boolean).join("\n\n");
  return { ...rec, text, chars: text.length, transcript: { seconds, at: now }, updatedAt: now };
}

const endpoint = (url: string) => `/api/transcribe?url=${encodeURIComponent(url)}`;

async function answer(response: Response): Promise<TranscriptStatus> {
  const data = await response.json().catch(() => null) as (TranscriptStatus & { error?: unknown }) | null;
  if (!response.ok || !data || typeof data.state !== "string") {
    const message = (data?.error as { message?: string } | undefined)?.message;
    throw new Error(message || `The server couldn't transcribe the video (HTTP ${response.status}).`);
  }
  return data;
}

/** What the server knows about the video on a post, without starting anything. */
export const transcriptStatus = async (url: string, signal?: AbortSignal) => answer(await fetch(endpoint(url), { signal }));

/** Start transcribing the post's video, or join the transcription already under way. */
export const startTranscript = async (url: string) => answer(await fetch(endpoint(url), { method: "POST" }));
