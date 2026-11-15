import { bandInfo, type Band } from "@readaloud/practice/bands";
import type { Passage } from "@readaloud/practice/passages";
import { PRACTICE_PASSAGES } from "@readaloud/practice/practicePassages";
import { dayOf, daysBetween } from "@readaloud/practice/score";
import type { Round } from "@readaloud/practice/store";
import { wordCount } from "@readaloud/practice/words";

/** Short level names for the home screen's four segments. */
export const SHORT_BAND: Record<Band, string> = { "6-8": "6–8", "9-12": "9–12", college: "College", advanced: "Advanced" };
export const bandTitle = (band: Band) => bandInfo(band).title;

/** "Tap" on a touch screen, "Click" with a mouse or trackpad. */
export const tap = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "Tap" : "Click");

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Who wrote a passage; a news passage is NPR's. */
export const authorOf = (p: Pick<Passage, "author" | "source">) => p.author ?? (p.source === "npr" ? "NPR" : "");
export const byline = (p: Pick<Passage, "title" | "author" | "source">) => [p.title, authorOf(p)].filter(Boolean).join(" · ");

/** A steady read-aloud pace, for "about 30 sec". */
const WORDS_PER_MINUTE = 140;
export function readingTime(text: string): string {
  const seconds = Math.max(5, Math.round((wordCount(text) / WORDS_PER_MINUTE) * 60 / 5) * 5);
  return seconds < 60 ? `about ${seconds} sec` : `about ${Math.round(seconds / 60)} min`;
}

/** "Today", "Yesterday", the weekday within a week, then the date. */
export function dayLabel(time: number, now = Date.now()): string {
  const days = daysBetween(dayOf(time), dayOf(now));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(time);
  return days < 7 ? date.toLocaleDateString("en-US", { weekday: "long" }) : date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** What a past round read: kept with the round, or found among the bundled passages. */
export function roundTitle(round: Round): { title: string; author: string; passage?: Passage } {
  const bundled = PRACTICE_PASSAGES.find((p) => p.id === round.passageId);
  return {
    title: round.title ?? bundled?.title ?? "Passage",
    author: round.author ?? bundled?.author ?? "",
    passage: bundled ? { ...bundled, source: "public-domain" } : undefined,
  };
}

/** "Clear, steady reading. Three words to practise." as a headline and the rest. */
export function headline(phrase: string): { head: string; rest: string } {
  const cut = phrase.indexOf(". ");
  if (cut < 0) return { head: phrase, rest: "" };
  return { head: phrase.slice(0, cut + 1), rest: phrase.slice(cut + 2).replace(/\.$/, "") };
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
