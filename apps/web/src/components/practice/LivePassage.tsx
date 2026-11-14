import { Fragment, useMemo } from "react";
import { cn } from "@readaloud/ui";
import type { LiveState } from "../../lib/practice/live";
import { tokens } from "../../lib/practice/words";
import { MARK } from "./verdicts";

/**
 * The passage while it is being read: words dim as the reader gets to them, and a word that was
 * skipped or misread is marked a few seconds later. Unclear words stay unmarked here, so nothing
 * doubtful distracts the reader; the results after the take have them.
 */
export function LivePassage({ text, live }: { text: string; live: LiveState }) {
  const all = useMemo(() => tokens(text), [text]);
  return <p className="m-0 font-serif text-lg leading-relaxed" data-live-cursor={live.cursor}>
    {all.map((t, i) => {
      const space = i && t.space ? " " : "";
      const verdict = live.words[i]?.verdict;
      const read = i < live.cursor;
      if (verdict === "mispronounced" || verdict === "substituted" || verdict === "skipped") {
        return <Fragment key={t.index}>{space}<span className={read ? "text-fg2" : undefined}>{t.pre}</span>
          <span data-live-mark={verdict} className={MARK[verdict].className}>{t.word}</span>
          <span className={read ? "text-fg2" : undefined}>{t.post}</span></Fragment>;
      }
      return <Fragment key={t.index}>{space}<span data-read={read || undefined} className={cn("transition-colors duration-base", read && "text-fg2")}>{t.pre}{t.word}{t.post}</span></Fragment>;
    })}
  </p>;
}
