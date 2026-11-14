import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Popover, cn } from "@readaloud/ui";
import type { WordResult } from "../../lib/practice/judge";
import { sentenceAround } from "../../lib/practice/wordInfo";
import { MARK, isMarked, markLine, openTint } from "./verdicts";
import { WordPractice } from "./WordPractice";

/**
 * The passage with each word's verdict marked. Correct words stay plain so the few marked ones
 * stand out; a marked word is a button that opens its popover under the word's line. A tap
 * anywhere else, the passage's own text included, closes the popover.
 */
export function MarkedPassage({ words, open, onOpen }: { words: WordResult[]; open: number | null; onOpen: (index: number | null) => void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const button = open === null ? undefined : buttons.current.get(open);
    if (!button) return;
    setTop(button.offsetTop + button.offsetHeight + 6);
    button.scrollIntoView({ block: "nearest" });
  }, [open]);
  const current = open === null ? undefined : words[open];
  const mark = current && isMarked(current.verdict) ? MARK[current.verdict] : null;

  return <div ref={wrapper} className="relative">
    <p className="m-0 font-serif text-lg leading-relaxed" onPointerDown={(e) => {
      // The popover counts this whole wrapper as its anchor, so taps on plain words are closed here.
      if (open !== null && !(e.target instanceof Element && e.target.closest("button"))) onOpen(null);
    }}>
      {words.map((w, i) => {
        const space = i && w.space ? " " : "";
        if (!isMarked(w.verdict)) return <Fragment key={w.index}>{space}{w.pre}{w.word}{w.post}</Fragment>;
        const expanded = open === w.index;
        // Kept with its punctuation on one line: a button is a place the line may otherwise break.
        return <Fragment key={w.index}>{space}<span className="whitespace-nowrap">{w.pre}<button
          type="button"
          ref={(el) => { if (el) buttons.current.set(w.index, el); else buttons.current.delete(w.index); }}
          aria-label={`${w.word}: ${MARK[w.verdict].label.toLowerCase()}`}
          aria-expanded={expanded}
          onClick={() => onOpen(expanded ? null : w.index)}
          className={cn("cursor-pointer [font:inherit]", MARK[w.verdict].className, expanded && "rounded-[4px]")}
          style={expanded ? { background: openTint(w.verdict) } : undefined}
        >{w.word}</button>{w.post}</span></Fragment>;
      })}
    </p>
    <Popover open={!!mark} onClose={() => onOpen(null)} side="bottom" align="start" offset={top} role="dialog" aria-label={current ? `Practise “${current.word}”` : undefined}
      className="left-0 right-0 translate-x-0" style={{ top }}>
      {current && mark && <WordPractice key={current.index} word={current.word} label={mark.label} labelClass={mark.labelClass} line={isMarked(current.verdict) ? markLine(current.verdict, current.heard) : mark.line} sentence={sentenceAround(words, current.index)} />}
    </Popover>
  </div>;
}

/** The key under the passage: a sample word in each mark's style. */
export function MarkKey() {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-3 text-[12px] text-fg2">
    {(["mispronounced", "substituted", "skipped", "unsure"] as const).map((v) => <div key={v} className="flex items-center gap-2">
      <span aria-hidden className={cn("font-serif text-[13px]", v === "unsure" && "text-fg", MARK[v].className)}>word</span>
      <span>{MARK[v].key}</span>
    </div>)}
  </div>;
}
