import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { Button, cn } from "@readaloud/ui";
import { useMicRecorder } from "../../hooks/useMicRecorder";
import { prepareTake } from "../../lib/practice/audio";
import { judgeWord } from "../../lib/practice/judge";
import { speakWord, stopPlayback } from "../../lib/practice/speak";
import { usePractice } from "../../state/practice";
import { Pronunciation, WordMeaning, useWordInfo } from "./WordAbout";

type Attempt = { state: "idle" } | { state: "checking" } | { state: "done"; ok: boolean; heard?: string } | { state: "error"; message: string };

/**
 * A word's popover body: the word and how to say it, a label, one line of help, Hear it and Try
 * this word, then what the word means and where it comes from. Trying records just the word and
 * checks it against a transcript of the clip. `sentence` is where the word was read, for its meaning there.
 */
export function WordPractice({ word, label, labelClass, line, sentence }: { word: string; label: ReactNode; labelClass?: string; line: string; sentence?: string }) {
  const [attempt, setAttempt] = useState<Attempt>({ state: "idle" });
  const [speaking, setSpeaking] = useState(false);
  const tryWord = usePractice((s) => s.tryWord);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const lookup = useWordInfo(word, sentence);

  const check = async (file: File) => {
    controller.current?.abort();
    const ac = new AbortController(); controller.current = ac;
    setAttempt({ state: "checking" });
    try {
      const take = await prepareTake(file);
      const { result, heard } = await judgeWord(word, take, ac.signal);
      if (ac.signal.aborted) return;
      // Only a clean read counts: a lone word is too easily misheard to hold a miss against the reader.
      if (result === "correct") tryWord(word, true);
      setAttempt(result === "unsure" ? { state: "error", message: "Nothing was heard clearly. Try once more." } : { state: "done", ok: result === "correct", heard });
    } catch (e) {
      if (ac.signal.aborted) return;
      setAttempt({ state: "error", message: e instanceof Error ? e.message : "Checking failed. Please try again." });
    }
  };
  const mic = useMicRecorder({ onRecorded: (file) => void check(file) });
  const record = () => { stopPlayback(); void mic.start(); };

  const hear = async () => {
    setSpeaking(true);
    try { await speakWord(word); }
    catch (e) { setAttempt({ state: "error", message: e instanceof Error ? e.message : "Couldn't play the word." }); }
    finally { setSpeaking(false); }
  };

  const status = mic.recording ? `Recording · ${mic.seconds}s. Say just “${word}”, then stop.`
    : attempt.state === "checking" ? "Checking…"
    : attempt.state === "done" ? (attempt.ok ? "That's it. Counted as a clean read." : `It sounded like “${attempt.heard}”. Listen once more and try again.`)
    : attempt.state === "error" ? attempt.message
    : mic.error || line;

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
      <Button variant="primary" size="lg" className="!h-11" loading={mic.starting || attempt.state === "checking"}
        leading={mic.recording ? <Square size={14} fill="currentColor" aria-hidden /> : <Mic size={16} aria-hidden />}
        onClick={() => mic.recording ? mic.stop() : record()}>
        {mic.recording ? "Stop" : attempt.state === "done" || attempt.state === "error" ? "Try again" : "Try this word"}
      </Button>
    </div>
    <WordMeaning lookup={lookup} />
  </div>;
}
