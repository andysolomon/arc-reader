import { soundAlike } from "./homophones";
import type { Token } from "./words";

/**
 * A transcript of the reading lined up against the passage. Each passage word comes out as read
 * correctly, read as something else (with what was heard), or skipped. Speech-to-text writes some
 * things its own way ("12" for "twelve", "color" for "colour", "hear" for "here", "Tucka hoe" for
 * "Tuckahoe"), so words are compared in a normal form and a stretch that doesn't line up word for
 * word is also compared as a whole.
 */
export type Heard =
  | { kind: "correct" }
  | { kind: "skipped" }
  /** `heard` is what the transcript has in this word's place; `close` when it resembles the word. */
  | { kind: "misread"; heard: string; close: boolean };

export interface Alignment {
  words: Heard[];
  /** Transcript words that match no passage word: repeats, false starts, asides. */
  added: number;
  /** Share of passage words read correctly, 0–1. */
  matched: number;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–9999 as the words a reader would say, for transcripts that write digits. */
export function numberWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return [];
  if (n < 20) return [ONES[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
  if (n < 1000) return [ONES[Math.floor(n / 100)], "hundred", ...(n % 100 ? ["and", ...numberWords(n % 100)] : [])];
  return [...numberWords(Math.floor(n / 1000)), "thousand", ...(n % 1000 ? [...(n % 1000 < 100 ? ["and"] : []), ...numberWords(n % 1000)] : [])];
}

const SAME: Record<string, string> = {
  mr: "mister", mrs: "missus", dr: "doctor", st: "saint", "&": "and", ok: "okay", gray: "grey",
  "1st": "first", "2nd": "second", "3rd": "third",
};

/** One spelling for words that are the same word in British and American English. */
function spelling(w: string): string {
  if (w.length <= 4) return w;
  return w
    .replace(/our(s|ed|ing|ite|ites|able|ably)?$/, "or$1")
    .replace(/is(e|es|ed|ing|ation|ations)$/, "iz$1")
    .replace(/ys(e|es|ed|ing)$/, "yz$1")
    .replace(/tre(s)?$/, "ter$1")
    // "travelled" and "traveled", but not "filled" and "filed": only after an earlier syllable.
    .replace(/^(.*[aeiouy][^aeiouy]+[aeiouy]+)ll(ed|ing|er|ers)$/, "$1l$2")
    .replace(/wards$/, "ward");
}

/** One form for a word: sound-alikes are listed as written ("practise"), so look before the spelling is changed. */
function canonical(word: string): string {
  const spelled = spelling(word);
  return soundAlike(word) ?? soundAlike(spelled) ?? spelled;
}

/**
 * The pieces a word is compared by, each as [key, plain]: lower case, no accents or punctuation,
 * split at hyphens and dashes. `key` also folds sound-alikes together; `plain` keeps the word's own
 * letters, for telling whether two words run together are the same as one ("week days", "weekdays").
 */
function forms(word: string): [string, string][] {
  return word.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’‘`]/g, "'")
    .split(/[\s\-–—/]+/)
    .flatMap((piece): [string, string][] => {
      const bare = piece.replace(/^[^a-z0-9&]+|[^a-z0-9&]+$/g, "").replace(/(\d),(?=\d)/g, "$1");
      if (!bare) return [];
      if (/^\d+$/.test(bare)) {
        const said = numberWords(Number(bare)).filter((w) => w !== "and");
        return said.length ? said.map((w) => [canonical(w), w]) : [[bare, bare]];
      }
      const plain = bare.replace(/'s$/, "s").replace(/[^a-z0-9&]/g, "");
      if (!plain) return [];
      const word = SAME[plain] ?? plain;
      return [[canonical(word), spelling(word)]];
    });
}

/** A word's comparison keys. */
export const normal = (word: string): string[] => forms(word).map(([key]) => key);

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** 0–1: how alike two words are, letter by letter. */
export const similarity = (a: string, b: string) => (a || b ? 1 - distance(a, b) / Math.max(a.length, b.length) : 1);
/** At or above this a misread word is "close": a slip of pronunciation rather than another word. */
export const CLOSE = 0.5;

type Op = "match" | "swap" | "skip" | "add";

/** Edit-distance alignment of two word lists; a swap between alike words costs less than between unlike ones. */
function alignPieces(want: string[], got: string[]): Op[] {
  const n = want.length, m = got.length;
  const cost = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 1; i <= n; i++) cost[i][0] = i;
  for (let j = 1; j <= m; j++) cost[0][j] = j;
  const swap = (i: number, j: number) => (want[i] === got[j] ? 0 : similarity(want[i], got[j]) >= CLOSE ? 0.7 : 1.2);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) cost[i][j] = Math.min(cost[i - 1][j - 1] + swap(i - 1, j - 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
  }
  const ops: Op[] = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && Math.abs(cost[i][j] - (cost[i - 1][j - 1] + swap(i - 1, j - 1))) < 1e-6) { ops.push(want[i - 1] === got[j - 1] ? "match" : "swap"); i--; j--; }
    else if (i > 0 && Math.abs(cost[i][j] - (cost[i - 1][j] + 1)) < 1e-6) { ops.push("skip"); i--; }
    else { ops.push("add"); j--; }
  }
  return ops.reverse();
}

export function alignTranscript(passage: Token[], transcript: string): Alignment {
  // Each passage word may be several pieces ("sun-kissed"); remember which word a piece belongs to.
  const want: string[] = [], wantPlain: string[] = [], owner: number[] = [];
  passage.forEach((t, index) => { for (const [key, plain] of forms(t.word)) { want.push(key); wantPlain.push(plain); owner.push(index); } });
  // The transcript's pieces, each with the word as written, to show the reader what was heard.
  const got: string[] = [], gotPlain: string[] = [], written: string[] = [];
  for (const raw of transcript.split(/\s+/).filter(Boolean)) {
    const shown = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
    for (const [key, plain] of forms(raw)) { got.push(key); gotPlain.push(plain); written.push(shown); }
  }
  /** Transcript pieces j..k as written, without repeating a word that made several pieces. */
  const shownAs = (from: number, to: number) => written.slice(from, to).filter((w, i, all) => i === 0 || w !== all[i - 1]).join(" ");
  const ops = alignPieces(want, got);

  // Per piece: matched, or what was heard in its place (null when skipped).
  const heard: (string | null | true)[] = new Array(want.length).fill(null);
  let added = 0;
  for (let k = 0, i = 0, j = 0; k < ops.length;) {
    if (ops[k] === "match") { heard[i++] = true; j++; k++; continue; }
    // A stretch that doesn't line up word for word: compare it as a whole too.
    const from = { i, j };
    for (; k < ops.length && ops[k] !== "match"; k++) {
      if (ops[k] === "swap") { heard[i++] = shownAs(j, j + 1); j++; }
      else if (ops[k] === "skip") heard[i++] = null;
      else { j++; added++; }
    }
    const wanted = want.slice(from.i, i), said = got.slice(from.j, j);
    if (wanted.length && wantPlain.slice(from.i, i).join("") === gotPlain.slice(from.j, j).join("")) {
      for (let p = from.i; p < i; p++) heard[p] = true;
      added -= Math.max(0, said.length - wanted.length);
    } else if (wanted.length === 1 && said.length > 1 && heard[from.i] !== true) {
      // One word heard as several ("otnetic" as "ot netic"): judge it against all of them.
      heard[from.i] = shownAs(from.j, j);
    }
  }

  const words: Heard[] = passage.map(() => ({ kind: "correct" }));
  const pieces: Record<number, (string | null | true)[]> = {};
  owner.forEach((index, p) => (pieces[index] ??= []).push(heard[p]));
  passage.forEach((t, index) => {
    const mine = pieces[index];
    if (!mine || mine.every((h) => h === true)) return; // punctuation-only tokens count as read
    const said = mine.filter((h): h is string => typeof h === "string");
    if (!said.length && mine.every((h) => h === null)) { words[index] = { kind: "skipped" }; return; }
    const whole = normal(t.word).join("");
    const text = said.filter((w, i) => i === 0 || w !== said[i - 1]).join(" ");
    words[index] = { kind: "misread", heard: text, close: similarity(whole, normal(text).join("")) >= CLOSE || mine.some((h) => h === true) };
  });
  const counted = words.filter((_, index) => pieces[index]);
  return { words, added, matched: counted.length ? counted.filter((w) => w.kind === "correct").length / counted.length : 0 };
}
