import type { Verdict } from "./hear";

export type Marked = Exclude<Verdict, "correct">;

/** What each mark is called and says. How it looks is each app's own. */
export const MARK_TEXT: Record<Marked, { label: string; key: string; line: string }> = {
  mispronounced: { label: "Mispronounced", key: "Mispronounced", line: "This word didn't sound right. Listen to it, then try just this word." },
  substituted: { label: "Different word", key: "Different word", line: "You read a different word here. Listen to it, then try just this word." },
  skipped: { label: "Skipped", key: "Skipped", line: "You skipped this word. Listen to it, then try just this word." },
  unsure: { label: "Unclear", key: "Unclear, not counted", line: "It wasn't clear how this word was read, so it isn't counted. Try just this word." },
};

export const isMarked = (v: Verdict): v is Marked => v !== "correct";

/** The line for a marked word, naming what was heard in its place when that is known. */
export function markLine(v: Marked, heard?: string): string {
  if (!heard) return MARK_TEXT[v].line;
  if (v === "substituted") return `It sounded like “${heard}” here. Listen to the word, then try just this word.`;
  if (v === "mispronounced") return `This word didn't sound right; it came out like “${heard}”. Listen to it, then try just this word.`;
  if (v === "unsure") return `This sounded like “${heard}”, which may just be how it was heard, so it isn't counted. Try just this word.`;
  return MARK_TEXT[v].line;
}

export const missedLabel = (n: number) => n === 1 ? "Missed once" : `Missed ${n} times`;
