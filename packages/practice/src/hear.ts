import { alignTranscript, normal, type Alignment } from "./align";
import type { Token } from "./words";

/**
 * Word verdicts from what a transcript heard. A transcript is good at finding a word that was
 * skipped or read as another word. It can't always tell a mispronounced word from a name or rare
 * word it spelled its own way, or one short word from another, so those are "unsure": shown, not
 * counted against the reader.
 */
export type Verdict = "correct" | "mispronounced" | "substituted" | "skipped" | "unsure";

export interface WordResult extends Token {
  verdict: Verdict;
  /** What the transcript has in this word's place, when it isn't the word. */
  heard?: string;
}

/** Short, common words a transcript often mishears for each other in fluent speech. */
const SMALL = new Set("a an the of in on at to as is it and or but for with by from that this his her its are was were be been has had have he she they we you i not no so if than then them their there".split(" "));

/** A name inside a sentence: its pronunciation is open, and a transcript spells it as it likes. */
const isName = (all: Token[], index: number) => /^\p{Lu}/u.test(all[index].word) && index > 0 && !/[.!?]["”’)]*$/.test(all[index - 1].post);

function verdict(all: Token[], index: number, heard: Alignment["words"][number]): Pick<WordResult, "verdict" | "heard"> {
  if (heard.kind === "correct") return { verdict: "correct" };
  if (heard.kind === "skipped") return { verdict: "skipped" };
  const want = normal(all[index].word), got = normal(heard.heard);
  const said = heard.heard || undefined;
  // One short word for another: as likely the transcript's slip as the reader's.
  if (want.length === 1 && SMALL.has(want[0]) && got.length > 0 && got.every((w) => SMALL.has(w))) return { verdict: "unsure", heard: said };
  // A name comes out of a transcript spelled any number of ways ("Coenties" as "coiny's", "quinty's").
  if (isName(all, index)) return { verdict: "unsure", heard: said };
  if (heard.close) {
    const a = want.join(""), b = got.join("");
    // Only an ending differs ("gravelled" heard as "gravel"), or part of a hyphenated word was heard.
    const stem = b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
    return { verdict: stem || !b ? "unsure" : "mispronounced", heard: said };
  }
  return { verdict: "substituted", heard: said };
}

/** Verdicts for the words of `all` from `base` on that an alignment covers. */
export function verdictsOf(all: Token[], base: number, heard: Alignment["words"]): WordResult[] {
  return heard.map((h, i) => ({ ...all[base + i], ...verdict(all, base + i, h) }));
}

export interface Hearing {
  words: WordResult[];
  /** Share of the passage read correctly, 0–1, before any benefit of the doubt. */
  matched: number;
  /** Words said that aren't in the passage: repeats, false starts. */
  added: number;
}

/** A run of this many skipped words is more often the transcript dropping a sentence than the reader. */
export const DROPPED_RUN = 5;
/** Below this share of the passage, the take is treated as off-script or silent. */
export const OFF_SCRIPT = 0.5;

/** Whether a first transcript looks like it dropped a stretch, so a second, slower one is worth making. */
export function looksDropped(alignment: Alignment): boolean {
  let run = 0;
  for (const w of alignment.words) {
    run = w.kind === "skipped" ? run + 1 : 0;
    if (run >= DROPPED_RUN) return true;
  }
  return alignment.matched < 0.8;
}

/**
 * Verdicts from one or more transcripts of the same take. A word any transcript heard correctly
 * is correct: none of them has seen the passage, so one would have to invent the right word.
 */
export function hearReading(all: Token[], transcripts: string[]): Hearing {
  const alignments = transcripts.map((t) => alignTranscript(all, t));
  const best = alignments.reduce((a, b) => (b.matched > a.matched ? b : a));
  const merged = best.words.map((w, i) => (alignments.some((a) => a.words[i].kind === "correct") ? { kind: "correct" as const } : w));
  const counted = all.filter((t) => normal(t.word).length).length;
  return {
    words: all.map((t, i) => ({ ...t, ...verdict(all, i, merged[i]) })),
    matched: counted ? merged.filter((w, i) => w.kind === "correct" && normal(all[i].word).length).length / counted : 0,
    added: best.added,
  };
}

/** One word on its own ("Try this word"): right if the transcript has it, unsure if it heard nothing. */
export function hearWord(word: string, transcript: string): "correct" | "wrong" | "unsure" {
  const want = normal(word), got = normal(transcript);
  if (!got.length) return "unsure";
  const letters = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (got.join("") === want.join("") || letters(transcript) === letters(word)) return "correct";
  for (let i = 0; i + want.length <= got.length; i++) if (want.every((w, k) => got[i + k] === w)) return "correct";
  return "wrong";
}
