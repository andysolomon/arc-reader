import { useState } from "react";
import { Button } from "@readaloud/ui";
import { ArrowBox } from "./parts";
import { WordPractice } from "./WordPractice";

export interface DrillWord {
  word: string;
  label: string;
  labelClass?: string;
  line: string;
  /** The sentence it was read in, when it comes from a reading, for its meaning there. */
  sentence?: string;
}

/** One word at a time, each with Hear it and Try this word, then back to where the drill began. */
export function WordDrill({ words, onDone }: { words: DrillWord[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const current = words[Math.min(i, words.length - 1)];
  const last = i >= words.length - 1;
  if (!current) return null;
  return <>
    <div>
      <p className="m-0 font-serif text-[19px] leading-[1.4]">Practise your words</p>
      <p role="status" className="m-0 text-[13px] text-fg2">Word {i + 1} of {words.length} · listen, then say just the word</p>
    </div>
    <section aria-label="Word to practise" className="rounded-panel border border-line bg-bg2">
      <WordPractice key={`${i}-${current.word}`} word={current.word} label={current.label} labelClass={current.labelClass} line={current.line} sentence={current.sentence} />
    </section>
    <div className="flex flex-col gap-2.5">
      <Button variant="primary" size="xl" className="w-full justify-between" trailing={<ArrowBox />} onClick={() => last ? onDone() : setI(i + 1)}>
        {last ? "Finish" : "Next word"}
      </Button>
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="secondary" size="lg" disabled={i === 0} onClick={() => setI(i - 1)}>Previous word</Button>
        <Button variant="secondary" size="lg" onClick={onDone}>Stop practising</Button>
      </div>
    </div>
  </>;
}
