import { displayText, tokens, type Token } from "./words";

/**
 * Reading Practice's judge: one Gemini Decision 1 request (through /api/decide) that hears the
 * recording and answers a choice question for every word, plus phrasing, expression and pace.
 */
export const JUDGE_MODEL = "gemini-decision-1";
/** Below this, a word the judge would mark wrong is "unsure": not counted, offered for a retry. */
export const SURE = 0.7;
/** At or above this, the take is treated as off-script or silent and not scored. */
export const OFF_SCRIPT = 0.6;

export type Verdict = "correct" | "mispronounced" | "substituted" | "skipped" | "unsure";
type Heard = Exclude<Verdict, "unsure">;

const WORD_CRITERIA: Record<Heard, string> = {
  correct: "Said this word recognisably, even with an accent, a regional pronunciation or a quick self-correction",
  mispronounced: "Tried to say this word but it came out wrong",
  substituted: "Said a different word in its place",
  skipped: "Left this word out",
};
export const PHRASING = ["word by word", "mostly two-word phrases", "mostly phrase groups", "meaningful phrases that follow the punctuation"];
export const EXPRESSION = ["flat, little expression", "some expression", "expressive, suits the meaning"];
export const PACE = ["much too slow", "a little slow", "steady, neither rushed nor slow", "a little fast", "much too fast"];

export interface WordResult extends Token {
  verdict: Verdict;
  /** The judge's probability for the verdict it picked. */
  confidence: number;
}

export interface Judgement {
  words: WordResult[];
  /** 1–4 on the NAEP oral reading fluency scale. */
  phrasing: number;
  /** 1–3. */
  expression: number;
  /** 1–5; 3 is steady. */
  pace: number;
  offScript: boolean;
}

/** Words either side of `index`, so a repeated word's question says which one is meant. */
function context(all: Token[], index: number) {
  const from = Math.max(0, index - 4), to = Math.min(all.length, index + 5);
  return all.slice(from, to).map((t, i) => `${i && t.space ? " " : ""}${t.index === index ? `[${t.word}]` : `${t.pre}${t.word}${t.post}`}`).join("");
}

export interface AudioInput {
  /** Base64 audio, no data: prefix. */
  data: string;
  format: "wav";
}

/**
 * What the judge hears and reads. OpenCode's System One takes media as chat-style parts in
 * `state`; the passage goes in the text part so every question can refer to it.
 */
function judgeState(intro: string, audio: AudioInput) {
  return [
    { type: "text", text: intro },
    { type: "input_audio", input_audio: audio },
  ];
}

export function judgeRequest(passage: string, audio: AudioInput) {
  const all = tokens(passage);
  const questions: Record<string, unknown> = {};
  for (const t of all) {
    questions[`w_${t.index}`] = {
      type: "choice",
      instructions: `Word ${t.index + 1} of ${all.length} in the passage is "${t.word}", here in brackets: "${context(all, t.index)}". In the recording, how did the reader say this word?`,
      criteria: WORD_CRITERIA,
    };
  }
  questions.phrasing = { type: "score", instructions: "How does the reader group words into phrases while reading the passage aloud?", criteria: PHRASING };
  questions.expression = { type: "score", instructions: "How much expression does the reader's voice carry while reading the passage?", criteria: EXPRESSION };
  questions.pace = { type: "score", instructions: "How is the reader's pace for reading this passage aloud?", criteria: PACE };
  questions.off_script = { type: "noul", instructions: "Is the recording silent, or does the speaker read something other than this passage?" };
  return {
    model: JUDGE_MODEL,
    state: judgeState(`A student is reading this passage aloud. The recording is attached.\n\nPassage: ${displayText(passage)}`, audio),
    questions,
  };
}

/** One word on its own, for "Try this word". */
export function wordRequest(word: string, audio: AudioInput) {
  return {
    model: JUDGE_MODEL,
    state: judgeState(`A student was asked to say the single word "${word}". The recording is attached.`, audio),
    questions: { w: { type: "choice", instructions: `In the recording, how did the student say "${word}"?`, criteria: WORD_CRITERIA } },
  };
}

interface Answer { choice?: unknown; confidence?: unknown; score?: unknown; noul?: unknown; probabilities?: unknown }
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isHeard = (v: unknown): v is Heard => typeof v === "string" && Object.hasOwn(WORD_CRITERIA, v);

/** A word's verdict. A low-confidence "wrong" becomes unsure; a low-confidence "correct" stays correct. */
export function verdictOf(answer: Answer | undefined): { verdict: Verdict; confidence: number } {
  if (!answer || !isHeard(answer.choice)) return { verdict: "unsure", confidence: 0 };
  const confidence = probability(answer.confidence) ? answer.confidence : 0;
  if (answer.choice !== "correct" && confidence < SURE) return { verdict: "unsure", confidence };
  return { verdict: answer.choice, confidence };
}

/** A 1-based level from a score answer (`score` is a probability-weighted 0-based index). */
function level(answer: Answer | undefined, levels: number) {
  const s = typeof answer?.score === "number" && Number.isFinite(answer.score) ? answer.score : (levels - 1) / 2;
  return Math.min(levels, Math.max(1, Math.round(s) + 1));
}

export function interpretJudgement(passage: string, data: { answers?: Record<string, Answer> } | null): Judgement {
  const answers = data?.answers;
  if (!answers || typeof answers !== "object") throw new Error("The judge sent no answers. Please try again.");
  const words = tokens(passage).map((t) => ({ ...t, ...verdictOf(answers[`w_${t.index}`]) }));
  if (words.length && words.every((w) => w.confidence === 0)) throw new Error("The judge's answers didn't match the passage. Please try again.");
  const off = answers.off_script?.noul;
  return {
    words,
    phrasing: level(answers.phrasing, PHRASING.length),
    expression: level(answers.expression, EXPRESSION.length),
    pace: level(answers.pace, PACE.length),
    offScript: probability(off) && off >= OFF_SCRIPT,
  };
}

/** Thrown when /api/decide has no OpenCode key, so the page can link to Settings. */
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
    if (response.status === 503) throw new JudgeNotConfigured(message || "Add your OpenCode key in Settings to check readings.");
    // OpenCode Go covers its own models only; Gemini Decision is billed to pay-as-you-go credits.
    if (response.status === 402) throw new Error("Checking readings needs OpenCode pay-as-you-go credits. An OpenCode Go plan doesn't cover the reading judge; add credits in the OpenCode console.");
    throw new Error(message || `Checking the reading failed (HTTP ${response.status}). Please retry.`);
  }
  return data ?? {};
}
