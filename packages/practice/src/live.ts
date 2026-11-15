import { alignPrefix } from "./align";
import { verdictsOf, type WordResult } from "./hear";
import type { Token } from "./words";

/**
 * The live coach: while a passage is being read, the reading so far is transcribed every couple of
 * seconds and the passage is marked as the reader goes. A transcript of audio that stops
 * mid-sentence invents its last words, so only the segments before the last one are trusted:
 * they are "committed" (their words get verdicts, and later transcripts start after them). The
 * last segment only moves the cursor that shows the reader's place.
 */
export interface Segment { start: number; end: number; text: string }

export interface LiveState {
  /** Verdicts for the passage's first `words.length` words, which are settled. */
  words: WordResult[];
  /** Seconds of the take already settled; the next transcript starts here. */
  audioFrom: number;
  /** How many passage words the reader has got to, at least `words.length`. */
  cursor: number;
}

export const LIVE_START: LiveState = { words: [], audioFrom: 0, cursor: 0 };

/** Words held back from the end of the unsettled segment: the last ones heard are the least sure. */
const HOLD_BACK = 2;
/**
 * The next transcript starts this long before the settled point. Segment times are approximate,
 * and starting late loses words; starting early only re-hears a few, which the alignment ignores.
 */
const OVERLAP = 0.6;
/** Settled segments must mostly be the passage; otherwise the transcript is noise and is ignored. */
const MIN_MATCHED = 0.5;
/** How many words ahead the place is looked for once it is lost, and how sure the find must be. */
const LOOK_AHEAD = 40;
const FOUND_WORDS = 4;
const FOUND_MATCHED = 0.75;

/**
 * Two or more words in a row missing from a short transcript are more often the transcript's gap
 * than the reader's, so the live coach leaves them unmarked for the full check to decide.
 */
function withoutSkippedRuns(words: WordResult[]): WordResult[] {
  return words.map((w, i) => (w.verdict === "skipped" && (words[i - 1]?.verdict === "skipped" || words[i + 1]?.verdict === "skipped") ? { ...w, verdict: "unsure" as const } : w));
}

/**
 * The state after a transcript of the audio from `state.audioFrom` on. `segments` are that
 * transcript's, timed from the start of the audio sent.
 */
export function advanceLive(state: LiveState, all: Token[], segments: Segment[]): LiveState {
  const spoken = segments.filter((s) => s.text.trim());
  if (!spoken.length) return state;
  let { words, audioFrom } = state;
  const settled = spoken.slice(0, -1);
  if (settled.length) {
    const base = words.length;
    const rest = all.slice(base);
    const text = settled.map((s) => s.text).join(" ");
    const aligned = alignPrefix(rest, text);
    if (aligned.reach && aligned.matched >= MIN_MATCHED) {
      words = [...words, ...withoutSkippedRuns(verdictsOf(all, base, aligned.words))];
      audioFrom = Math.max(audioFrom, state.audioFrom + settled[settled.length - 1].end - OVERLAP);
    } else {
      // Lost the place (a transcript dropped a stretch, or the reader jumped ahead): look for the
      // text a little further on, and leave the words in between for the full check.
      for (let ahead = 1; ahead <= LOOK_AHEAD && ahead < rest.length; ahead++) {
        const found = alignPrefix(rest.slice(ahead), text);
        if (found.reach >= FOUND_WORDS && found.matched >= FOUND_MATCHED) {
          const between = rest.slice(0, ahead).map((t): WordResult => ({ ...t, verdict: "unsure" }));
          words = [...words, ...between, ...withoutSkippedRuns(verdictsOf(all, base + ahead, found.words))];
          audioFrom = Math.max(audioFrom, state.audioFrom + settled[settled.length - 1].end - OVERLAP);
          break;
        }
      }
    }
  }
  // The reader's place: everything settled, plus the unsettled words heard exactly as written, less
  // a little. An invented ending strays from the passage at once, so the cursor stops before it.
  const tail = words.length > state.words.length ? [spoken[spoken.length - 1]] : spoken;
  const reached = alignPrefix(all.slice(words.length), tail.map((s) => s.text).join(" "));
  const stray = reached.words.findIndex((w) => w.kind !== "correct");
  const tentative = Math.max(0, (stray < 0 ? reached.reach : stray) - HOLD_BACK);
  return { words, audioFrom, cursor: Math.max(state.cursor, words.length + tentative) };
}
