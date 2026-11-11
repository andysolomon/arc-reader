import { visualNarration, type VisualDescriptions } from "./visuals";
import type { ParagraphLike } from "@readaloud/ui";
import { readingBlocks, codeNarration, codeKey, safeCodeSummary, type CodeSummaries } from "./codeBlocks";

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

/** A Markdown heading on a line of its own: "## Why databases exist". */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Paragraphs of prose, with headings kept apart from the text under them. */
export function proseParts(text: string): { text: string; heading?: number }[] {
  const parts: { text: string; heading?: number }[] = [];
  let lines: string[] = [];
  const flush = () => {
    for (const p of splitParagraphs(lines.join("\n"))) parts.push({ text: p });
    lines = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(HEADING);
    if (!heading) { lines.push(line); continue; }
    flush();
    parts.push({ text: heading[2], heading: heading[1].length });
  }
  flush();
  return parts;
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

export function segment(text: string, summaries: CodeSummaries = {}, descriptions: VisualDescriptions = {}): Segmented {
  const sentences: Sentence[] = [];
  const paragraphs: ParagraphLike[] = [];
  for (const block of readingBlocks(text)) {
    const narration = block.kind === "visual" ? visualNarration(block.visual, descriptions) : null;
    const parts = narration ? [{ text: narration.text }] : block.kind === "code" ? [{ text: codeNarration(block, summaries) }] : proseParts(block.text);
    for (const { text: p, heading } of parts) {
      const start = sentences.length;
      // One seek target per code block or visual, even when its explanation has several sentences.
      const ss = (block.kind !== "prose" ? [p] : splitSentences(p)).map((t) => {
        const s: Sentence = { index: sentences.length, para: paragraphs.length, text: t, words: splitWords(t) };
        sentences.push(s);
        return { text: s.text, words: s.words };
      });
      if (ss.length) paragraphs.push({ sentences: ss, start, ...(block.kind === "code" ? {
        code: { text: block.text, language: block.language, summarized: safeCodeSummary(summaries[codeKey(block)]) },
      } : block.kind === "visual" ? { visual: { ...block.visual, source: narration!.source } } : heading ? { heading } : {}) });
    }
  }
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

/**
 * A run of consecutive sentences synthesized as one request. Generative voices
 * re-decide pitch, pace and energy on every call, so sending single sentences
 * made the voice shift at every boundary; a passage keeps that drift to
 * paragraph (or long-paragraph) joins.
 */
export interface Passage {
  index: number;
  /** First sentence index (inclusive). */
  start: number;
  /** Last sentence index (exclusive). */
  end: number;
  text: string;
  /** Words per sentence, for alignment inside the clip. */
  parts: string[][];
}

/** Upper bound per passage (≈ 20 s of speech), so the first clip is not long in coming. */
export const PASSAGE_MAX_WORDS = 60;

/**
 * Plan passages: never across a paragraph; a paragraph over the limit is cut
 * into roughly equal shares rather than a long run plus a stub. A pure function
 * of the text, so cache keys are stable across sessions.
 */
export function planPassages(sentences: Pick<Sentence, "text" | "words" | "para">[], maxWords = PASSAGE_MAX_WORDS): Passage[] {
  const out: Passage[] = [];
  const push = (start: number, end: number) => {
    const run = sentences.slice(start, end);
    out.push({ index: out.length, start, end, text: run.map((s) => s.text).join(" "), parts: run.map((s) => s.words) });
  };
  let i = 0;
  while (i < sentences.length) {
    let j = i;
    let total = 0;
    while (j < sentences.length && sentences[j].para === sentences[i].para) total += sentences[j++].words.length;
    const target = total / Math.max(1, Math.ceil(total / maxWords));
    let start = i;
    let acc = 0;
    for (let k = i; k < j; k++) {
      const n = sentences[k].words.length;
      if (acc > 0 && (acc >= target || acc + n > maxWords)) {
        push(start, k);
        start = k;
        acc = 0;
      }
      acc += n;
    }
    push(start, j);
    i = j;
  }
  return out;
}
