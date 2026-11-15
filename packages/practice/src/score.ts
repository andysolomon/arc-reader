import type { Judgement, WordResult } from "./judge";

export interface Score {
  /** Words the reader got right. */
  correct: number;
  /** Words that count: every word except unsure ones. */
  counted: number;
  unsure: number;
  /** 0–100, rounded. */
  accuracy: number;
  /** Words correct per minute of speech, rounded. */
  wcpm: number;
  /** Words to practise: mispronounced, substituted or skipped. */
  missed: WordResult[];
  points: number;
}

/** Seconds of speech, the take's length without silence before and after the reading. */
export function scoreReading(judgement: Judgement, speechSeconds: number): Score {
  const correct = judgement.words.filter((w) => w.verdict === "correct").length;
  const unsure = judgement.words.filter((w) => w.verdict === "unsure").length;
  const counted = judgement.words.length - unsure;
  const missed = judgement.words.filter((w) => w.verdict !== "correct" && w.verdict !== "unsure");
  const minutes = speechSeconds > 0 ? speechSeconds / 60 : 0;
  return {
    correct,
    counted,
    unsure,
    accuracy: counted ? Math.round((correct / counted) * 100) : 0,
    wcpm: minutes ? Math.round(correct / minutes) : 0,
    missed,
    points: correct,
  };
}

const NUMBERS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => NUMBERS[n] ?? String(n);
const toPractise = (n: number) => n === 1 ? "One word to practise." : `${count(n)} words to practise.`;

/** One plain sentence about the reading, chosen by accuracy and pace (1–5, 3 steady). */
export function feedback(score: Score, pace: number): string {
  const n = score.missed.length;
  const steady = pace === 3;
  if (score.accuracy >= 99 && n === 0) return steady ? "Clean, steady reading. Every word landed." : "Every word landed. Work on an even pace next.";
  if (score.accuracy >= 93) return `${steady ? "Clear, steady reading." : pace < 3 ? "Clear reading, a little slow." : "Clear reading, a little quick."} ${toPractise(n)}`;
  if (score.accuracy >= 85) return `Mostly accurate. ${toPractise(n)}`;
  if (score.accuracy >= 70) return `A good attempt. ${toPractise(n)}`;
  return "This one was hard. Try it again, or pick an easier level.";
}

/** The local calendar day, as YYYY-MM-DD. */
export function dayOf(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  const ms = (day: string) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}
