import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { stopPlayback } from "@readaloud/practice/speak";
import { CloseButton } from "../ui";
import { CleanReads, Tag, WordBody, type PracticeWord } from "./Word";

/** One word at a time, each with Hear it and Try this word, then back to where the drill began. */
export function Drill({ words, onDone }: { words: PracticeWord[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const current = words[Math.min(i, words.length - 1)];
  const last = i >= words.length - 1;
  if (!current) return null;
  const go = (to: number) => { stopPlayback(); setI(to); };
  const done = () => { stopPlayback(); onDone(); };
  return <div className="screen screen-gap" data-screen="drill">
    <header className="topbar"><CloseButton onClick={done} label="Stop practising" /><span className="topbar-title">Practise your words</span><span className="topbar-spacer" /></header>
    <main className="screen-main">
    <div className="drill-progress">
      <div role="img" aria-label={`Word ${i + 1} of ${words.length}`} className="drill-steps">
        {words.map((_, n) => <span key={n} className={n <= i ? "on" : undefined} />)}
      </div>
      <span role="status" className="drill-status">Word {i + 1} of {words.length} · listen, then say just the word</span>
    </div>
    <section aria-label="Word to practise" className="card drill-card">
      <div className="drill-card-head"><Tag word={current} /><CleanReads word={current.word} /></div>
      <WordBody key={`${i}-${current.word}`} word={current} />
    </section>
    <div className="stack">
      <button type="button" className="btn btn-primary" onClick={() => last ? done() : go(i + 1)}>
        <span>{last ? "Finish" : "Next word"}</span>{!last && <ArrowRight size={20} aria-hidden />}
      </button>
      <div className="grid2">
        <button type="button" className="btn btn-soft" disabled={i === 0} onClick={() => go(i - 1)}>Previous</button>
        <button type="button" className="btn btn-soft" onClick={done}>Stop practising</button>
      </div>
    </div>
    </main>
  </div>;
}
