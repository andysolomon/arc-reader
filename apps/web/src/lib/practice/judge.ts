import { studioUrl, errorMessage } from "../studio";
import { withSpeechAuth } from "../speechServer";
import type { PreparedTake } from "./audio";
import { alignTranscript } from "./align";
import { hearReading, hearWord, looksDropped, OFF_SCRIPT, type Hearing, type WordResult } from "./hear";
import { displayText, tokens } from "./words";

export type { Verdict, WordResult } from "./hear";

/**
 * Reading Practice's judge, in two parts that run side by side:
 *
 * - Words come from a transcript. The speech server's Whisper writes down what it hears, with no
 *   hint of the passage, and the transcript is lined up against the passage (align.ts, hear.ts).
 *   Measured with scripts/practice-eval.ts, this finds skipped and misread words far better than
 *   asking a model about each word in the audio.
 * - Phrasing, expression and pace come from Gemini Decision 1 (through /api/decide), which hears
 *   the recording itself. A reading can be scored without it.
 */
export const JUDGE_MODEL = "gemini-decision-1";

export const PHRASING = ["word by word", "mostly two-word phrases", "mostly phrase groups", "meaningful phrases that follow the punctuation"];
export const EXPRESSION = ["flat, little expression", "some expression", "expressive, suits the meaning"];
export const PACE = ["much too slow", "a little slow", "steady, neither rushed nor slow", "a little fast", "much too fast"];

export interface Prosody {
  /** 1–4 on the NAEP oral reading fluency scale. */
  phrasing: number;
  /** 1–3. */
  expression: number;
  /** 1–5; 3 is steady. */
  pace: number;
}

export interface Judgement {
  words: WordResult[];
  /** Null when Gemini couldn't be asked; `prosodyIssue` says why. */
  prosody: Prosody | null;
  prosodyIssue?: "no-key" | string;
  /** The take was silent or mostly not this passage, so it isn't scored. */
  offScript: boolean;
}

export interface AudioInput {
  /** Base64 audio, no data: prefix. */
  data: string;
  format: "wav";
}

/** The three questions about how the passage was read; media goes in `state` as chat-style parts. */
export function prosodyRequest(passage: string, audio: AudioInput) {
  return {
    model: JUDGE_MODEL,
    state: [
      { type: "text", text: `A student is reading this passage aloud. The recording is attached.\n\nPassage: ${displayText(passage)}` },
      { type: "input_audio", input_audio: audio },
    ],
    questions: {
      phrasing: { type: "score", instructions: "How does the reader group words into phrases while reading the passage aloud?", criteria: PHRASING },
      expression: { type: "score", instructions: "How much expression does the reader's voice carry while reading the passage?", criteria: EXPRESSION },
      pace: { type: "score", instructions: "How is the reader's pace for reading this passage aloud?", criteria: PACE },
    },
  };
}

interface Answer { score?: unknown }

/** A 1-based level from a score answer (`score` is a probability-weighted 0-based index). */
function level(answer: Answer | undefined, levels: number): number {
  if (typeof answer?.score !== "number" || !Number.isFinite(answer.score)) throw new Error("The judge sent no answer about how the passage was read.");
  return Math.min(levels, Math.max(1, Math.round(answer.score) + 1));
}

export function interpretProsody(data: { answers?: Record<string, Answer> } | null): Prosody {
  const answers = data?.answers ?? {};
  return { phrasing: level(answers.phrasing, PHRASING.length), expression: level(answers.expression, EXPRESSION.length), pace: level(answers.pace, PACE.length) };
}

/** Thrown when /api/decide has no key for the judge, so the page can link to Settings. */
export class JudgeNotConfigured extends Error {}

/** POST a request to /api/decide and return its parsed answers. */
export async function askJudge(request: unknown, signal?: AbortSignal): Promise<{ answers?: Record<string, Answer> }> {
  const response = await fetch("/api/decide/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const data = await response.json().catch(() => null) as { answers?: Record<string, Answer>; error?: { message?: string } | string; detail?: unknown } | null;
  if (!response.ok) {
    const message = typeof data?.error === "object" ? data.error?.message : typeof data?.error === "string" ? data.error : typeof data?.detail === "string" ? data.detail : null;
    if (response.status === 503) throw new JudgeNotConfigured(message || "Add a Gemini API key in Settings to check readings.");
    // Without a Gemini key the judge goes through OpenCode, where it needs pay-as-you-go credits (Go doesn't cover it).
    if (response.status === 402) throw new Error("OpenCode has no pay-as-you-go credits for the reading judge. Add a Gemini API key in Settings → Practice instead.");
    if (response.status === 429) throw new Error("Google's limit for the reading judge was reached. Try again in a minute.");
    throw new Error(message || `Checking the reading failed (HTTP ${response.status}). Please retry.`);
  }
  return data ?? {};
}

const BUSY_RETRIES = 3;
const BUSY_WAIT_MS = 3000;

export interface Transcript {
  text: string;
  /** Stretches of the transcript with their times in the audio, in seconds. */
  segments: { start: number; end: number; text: string }[];
}

/**
 * What the speech server hears in some audio. "fast" is Whisper Turbo; "accurate" is the server's
 * selected recognizer, slower and less likely to drop a sentence. No vocabulary hint and no
 * clean-up, so the words are the reader's. A busy server is waited for `retries` times.
 */
export async function transcribeAudio(wav: Blob, mode: "fast" | "accurate", signal?: AbortSignal, retries = BUSY_RETRIES): Promise<Transcript> {
  const url = studioUrl("/transcribe");
  for (let attempt = 0; ; attempt++) {
    const body = new FormData();
    body.set("audio", new File([wav], "reading.wav", { type: "audio/wav" }));
    body.set("mode", mode);
    const response = await fetch(url, withSpeechAuth(url, { method: "POST", body, signal })).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      throw new Error("Couldn't reach the speech server to check the reading. Please try again.");
    });
    if (response.status === 429 && attempt < retries) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, BUSY_WAIT_MS);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      continue;
    }
    if (response.status === 429) throw new Error("The speech server is busy with other speech. Try again in a moment.");
    const data = await response.json().catch(() => null) as { text?: unknown; segments?: unknown } | null;
    if (!response.ok) throw new Error(`The speech server couldn't check the reading: ${data ? errorMessage(data) : `HTTP ${response.status}`}`);
    const segments = Array.isArray(data?.segments) ? data.segments.filter((s): s is Transcript["segments"][number] =>
      !!s && typeof s.text === "string" && Number.isFinite(s.start) && Number.isFinite(s.end)) : [];
    return { text: typeof data?.text === "string" ? data.text : "", segments };
  }
}

/** The words of a take, as text. */
export const transcribeTake = async (wav: Blob, mode: "fast" | "accurate", signal?: AbortSignal): Promise<string> => (await transcribeAudio(wav, mode, signal)).text;

export type Transcriber = (wav: Blob, mode: "fast" | "accurate", signal?: AbortSignal) => Promise<string>;

/** The passage's words as heard: a fast transcript, and a slower second one when the first looks like it dropped a stretch. */
export async function hearTake(passage: string, wav: Blob, signal?: AbortSignal, transcribe: Transcriber = transcribeTake): Promise<Hearing> {
  const all = tokens(passage);
  const fast = await transcribe(wav, "fast", signal);
  if (!looksDropped(alignTranscript(all, fast))) return hearReading(all, [fast]);
  // If the second pass fails, the first still stands.
  const slow = await transcribe(wav, "accurate", signal).catch((error: unknown) => { if (signal?.aborted) throw error; return null; });
  return hearReading(all, slow === null ? [fast] : [fast, slow]);
}

/** Judge one take: its words from the transcript, and how it was read from Gemini, at the same time. */
export async function judgeReading(passage: string, take: PreparedTake, signal?: AbortSignal): Promise<Judgement> {
  const prosody = askJudge(prosodyRequest(passage, take.audio), signal).then(interpretProsody)
    .then((value) => ({ value, issue: undefined as Judgement["prosodyIssue"] }))
    .catch((error: unknown) => {
      if (signal?.aborted) throw error;
      return { value: null, issue: error instanceof JudgeNotConfigured ? "no-key" as const : error instanceof Error ? error.message : "The judge couldn't be reached." };
    });
  // An unhandled rejection if the transcript fails first.
  prosody.catch(() => undefined);
  const hearing = await hearTake(passage, take.wav, signal);
  const read = await prosody;
  return { words: hearing.words, prosody: read.value, prosodyIssue: read.issue, offScript: hearing.matched < OFF_SCRIPT };
}

/**
 * "Try this word": the word on its own, checked against a transcript of the clip. A lone word
 * gives a transcript no context ("hallow" comes back as "hollow"), so anything but a match is
 * reported with what was heard and never counted against the reader.
 */
export async function judgeWord(word: string, take: PreparedTake, signal?: AbortSignal): Promise<{ result: "correct" | "wrong" | "unsure"; heard: string }> {
  const transcript = await transcribeTake(take.wav, "fast", signal);
  return { result: hearWord(word, transcript), heard: transcript.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase() };
}
