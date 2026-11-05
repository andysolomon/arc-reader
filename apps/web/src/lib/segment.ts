import type { ParagraphLike } from "@readaloud/ui";

export interface Sentence {
  index: number;
  para: number;
  text: string;
  words: string[];
}

export interface Segmented {
  sentences: Sentence[];
  paragraphs: ParagraphLike[];
}

/** Words per second at 1× when the provider has no timestamps. */
export const WPS = 2.83;
/** Extra "words" of silence budgeted per sentence boundary. */
export const SENTENCE_PAUSE_WORDS = 1.2;

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Split on . ! ? … followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["'”’)]?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitWords(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean);
}

export function segment(text: string): Segmented {
  const sentences: Sentence[] = [];
  const paragraphs: ParagraphLike[] = [];
  splitParagraphs(text).forEach((p, pi) => {
    const start = sentences.length;
    const ss = splitSentences(p).map((t) => {
      const s: Sentence = { index: sentences.length, para: pi, text: t, words: splitWords(t) };
      sentences.push(s);
      return { text: s.text, words: s.words };
    });
    if (ss.length) paragraphs.push({ sentences: ss, start });
  });
  return { sentences, paragraphs };
}

/** Estimated duration of a sentence in seconds at 1×. */
export function estimateDuration(words: string[] | number): number {
  const n = typeof words === "number" ? words : words.length;
  return (n + SENTENCE_PAUSE_WORDS) / WPS;
}

export function estimateTotal(text: string): number {
  return segment(text).sentences.reduce((a, s) => a + estimateDuration(s.words), 0);
}

export function titleFrom(text: string, max = 64): string {
  const first = segment(text).sentences[0]?.text ?? text.trim();
  const t = first.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t || "Untitled";
}
