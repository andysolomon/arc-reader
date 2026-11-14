import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Mic } from "lucide-react";
import { Button, Popover, SectionLabel, cn } from "@readaloud/ui";
import { CLEAN_TO_MASTER, mastered, toGo, usePractice, type BankWord } from "../../state/practice";
import { wordKey } from "../../lib/practice/words";
import { WordPractice } from "./WordPractice";

const missedLabel = (n: number) => n === 1 ? "Missed once" : `Missed ${n} times`;

/** Words to practise, most-missed first, each opening the same popover as Results. */
export function WordBank({ onPractise }: { onPractise: () => void }) {
  const words = usePractice((s) => s.words);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [top, setTop] = useState(0);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const pending = toGo(words);
  const done = mastered(words);
  const openWord = open ? words[open] : undefined;
  useLayoutEffect(() => {
    const row = open ? rows.current.get(open) : undefined;
    if (row) setTop(row.offsetTop + row.offsetHeight + 6);
  }, [open]);
  if (!pending.length) return null;
  const shown = all ? pending : pending.slice(0, 3);

  return <section aria-label="Words to practise" className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-3">
      <SectionLabel>Words to practise</SectionLabel>
      <span className="text-[12px] text-fg2">{pending.length} to go{done ? ` · ${done} mastered` : ""}</span>
    </div>
    <div className="relative rounded-panel border border-line bg-bg2">
      {shown.map((w, i) => <Row key={wordKey(w.word)} w={w} last={i === shown.length - 1 && pending.length <= 3}
        rowRef={(el) => { const k = wordKey(w.word); if (el) rows.current.set(k, el); else rows.current.delete(k); }}
        expanded={open === wordKey(w.word)} onClick={() => setOpen((o) => o === wordKey(w.word) ? null : wordKey(w.word))} />)}
      {pending.length > 3 && <button type="button" onClick={() => setAll((a) => !a)} className="h-[46px] w-full rounded-b-panel text-[13px] text-fg2 hover:bg-bg3">
        {all ? "Show fewer" : `Show all ${pending.length} words`}
      </button>}
      <Popover open={!!openWord} onClose={() => setOpen(null)} side="bottom" align="start" offset={top} role="dialog" aria-label={openWord ? `Practise “${openWord.word}”` : undefined}
        className="left-0 right-0 translate-x-0" style={{ top }}>
        {openWord && <WordPractice key={open} word={openWord.word} label={missedLabel(openWord.missed)} line="Listen to it, then try just this word." />}
      </Popover>
    </div>
    <Button variant="secondary" size="lg" className="w-full" leading={<Mic size={16} aria-hidden />} onClick={onPractise}>
      Practise my words
    </Button>
  </section>;
}

function Row({ w, last, expanded, onClick, rowRef }: { w: BankWord; last: boolean; expanded: boolean; onClick: () => void; rowRef: (el: HTMLButtonElement | null) => void }) {
  return <button ref={rowRef} type="button" aria-expanded={expanded} onClick={onClick}
    className={cn("flex min-h-[62px] w-full items-center gap-3 px-4 py-2.5 text-left first:rounded-t-panel hover:bg-bg3", !last && "border-b border-line", last && "rounded-b-panel")}>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-serif text-[17px]">{w.word}</span>
      <span className="text-[13px] text-fg2">{missedLabel(w.missed)}</span>
    </span>
    <span role="img" aria-label={`${w.clean} of ${CLEAN_TO_MASTER} clean reads`} className="flex gap-1">
      {Array.from({ length: CLEAN_TO_MASTER }, (_, i) => <span key={i} className={cn("h-1 w-3.5 rounded-full", i < w.clean ? "bg-accent" : "bg-line")} />)}
    </span>
    <ChevronRight size={16} className="text-fg2" aria-hidden />
  </button>;
}
