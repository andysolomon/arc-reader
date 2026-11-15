import { useState } from "react";
import { ChevronRight, Mic } from "lucide-react";
import { missedLabel } from "@readaloud/practice/marks";
import { CLEAN_TO_MASTER, toGo, type BankWord } from "@readaloud/practice/store";
import { wordKey } from "@readaloud/practice/words";
import { usePractice } from "../store";
import { dayLabel } from "../text";
import { Meter, Segmented } from "../ui";
import { WordSheet, type PracticeWord } from "./Word";

/** A word from the bank as something to practise. */
export const bankWord = (w: BankWord): PracticeWord => ({ word: w.word, label: missedLabel(w.missed), tone: "accent", line: "Listen to it, then try just this word." });

/** "Missed once · today"; older misses just say how often. */
function missedWhen(w: BankWord): string {
  const day = dayLabel(w.lastAt);
  return day === "Today" || day === "Yesterday" ? `${missedLabel(w.missed)} · ${day.toLowerCase()}` : missedLabel(w.missed);
}

export function Words({ onPractise }: { onPractise: (words: PracticeWord[]) => void }) {
  const words = usePractice((s) => s.words);
  const [tab, setTab] = useState<"todo" | "mastered">("todo");
  const [open, setOpen] = useState<string | null>(null);
  const pending = toGo(words);
  const done = Object.values(words).filter((w) => w.clean >= CLEAN_TO_MASTER).sort((a, b) => b.lastAt - a.lastAt);
  const shown = tab === "todo" ? pending : done;
  const openWord = open ? words[open] : undefined;

  return <main className="page page-list" style={{ gap: 20 }}>
    <header className="page-head">
      <h1 className="title">Words</h1>
      <p className="subtitle">A word is mastered after three clean reads.</p>
    </header>
    <Segmented label="Word bank" role="tablist" value={tab} onChange={setTab}
      options={[{ id: "todo", label: `To practise · ${pending.length}` }, { id: "mastered", label: `Mastered · ${done.length}` }]} />
    {shown.length ? <section aria-label={tab === "todo" ? "Words to practise" : "Mastered words"} className="list">
      {shown.map((w) => <button key={wordKey(w.word)} type="button" className="list-row" aria-haspopup="dialog" onClick={() => setOpen(wordKey(w.word))}>
        <span className="list-body">
          <span className="list-main"><span className="list-title">{w.word}</span><span className="list-sub">{tab === "todo" ? missedWhen(w) : "Mastered"}</span></span>
          <Meter value={Math.min(w.clean, CLEAN_TO_MASTER)} of={CLEAN_TO_MASTER} label={`${Math.min(w.clean, CLEAN_TO_MASTER)} of ${CLEAN_TO_MASTER} clean reads`} />
          <ChevronRight size={18} className="chevron" aria-hidden />
        </span>
      </button>)}
    </section> : <p className="empty">{tab === "todo"
      ? (done.length ? "Nothing to practise. Every word you missed is mastered." : "Words you miss in a reading are kept here to practise.")
      : "Words you've read cleanly three times will show here."}</p>}
    {tab === "todo" && pending.length > 0 && <button type="button" className="btn btn-primary" onClick={() => onPractise(pending.map(bankWord))}>
      <Mic size={20} aria-hidden /><span>Practise my words</span>
    </button>}
    {openWord && <WordSheet key={open} word={bankWord(openWord)} onClose={() => setOpen(null)} />}
  </main>;
}
