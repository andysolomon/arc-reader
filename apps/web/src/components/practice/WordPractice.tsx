import type { ReactNode } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { Button, cn } from "@readaloud/ui";
import { useWordAttempt } from "@readaloud/practice/useWordAttempt";
import { usePractice } from "../../state/practice";
import { Pronunciation, WordMeaning, useWordInfo } from "./WordAbout";

/**
 * A word's popover body: the word and how to say it, a label, one line of help, Hear it and Try
 * this word, then what the word means and where it comes from. Trying records just the word and
 * checks it against a transcript of the clip. `sentence` is where the word was read, for its meaning there.
 */
export function WordPractice({ word, label, labelClass, line, sentence }: { word: string; label: ReactNode; labelClass?: string; line: string; sentence?: string }) {
  const tryWord = usePractice((s) => s.tryWord);
  const { attempt, status, speaking, hear, recording, busy, toggle, action } = useWordAttempt(word, line, (w) => tryWord(w, true));
  const lookup = useWordInfo(word, sentence);

  return <div className="flex flex-col gap-3 p-3.5">
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-[22px] font-medium">{word}</span>
        <span className={cn("text-[12px]", labelClass ?? "text-fg2")}>{label}</span>
      </div>
      <Pronunciation lookup={lookup} />
    </div>
    <p role="status" className={cn("m-0 text-[13px]", attempt.state === "done" && attempt.ok ? "text-fg" : "text-fg2")}>{status}</p>
    <div className="grid grid-cols-2 gap-2.5">
      <Button variant="secondary" size="lg" className="!h-11 !bg-bg" loading={speaking} leading={<Volume2 size={16} aria-hidden />} onClick={() => void hear()}>Hear it</Button>
      <Button variant="primary" size="lg" className="!h-11" loading={busy}
        leading={recording ? <Square size={14} fill="currentColor" aria-hidden /> : <Mic size={16} aria-hidden />}
        onClick={toggle}>
        {action}
      </Button>
    </div>
    <WordMeaning lookup={lookup} />
  </div>;
}
