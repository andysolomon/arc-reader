import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { Button, cn } from "@readaloud/ui";
import { useMicRecorder } from "../../hooks/useMicRecorder";
import { prepareTake } from "../../lib/practice/audio";
import { askJudge, JudgeNotConfigured, verdictOf, wordRequest } from "../../lib/practice/judge";
import { speakWord } from "../../lib/practice/speak";
import { usePractice } from "../../state/practice";

type Attempt = { state: "idle" } | { state: "checking" } | { state: "done"; ok: boolean } | { state: "error"; message: string };

/**
 * A word's popover body: the word, a label, one line of help, then Hear it and Try this word.
 * Trying records just the word and asks the judge one question about it.
 */
export function WordPractice({ word, label, labelClass, line }: { word: string; label: ReactNode; labelClass?: string; line: string }) {
  const [attempt, setAttempt] = useState<Attempt>({ state: "idle" });
  const [speaking, setSpeaking] = useState(false);
  const tryWord = usePractice((s) => s.tryWord);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);

  const check = async (file: File) => {
    controller.current?.abort();
    const ac = new AbortController(); controller.current = ac;
    setAttempt({ state: "checking" });
    try {
      const take = await prepareTake(file);
      const data = await askJudge(wordRequest(word, take.audio), ac.signal);
      if (ac.signal.aborted) return;
      const { verdict } = verdictOf(data.answers?.w);
      const ok = verdict === "correct";
      if (verdict !== "unsure") tryWord(word, ok);
      setAttempt(verdict === "unsure" ? { state: "error", message: "That wasn't clear enough to check. Try once more." } : { state: "done", ok });
    } catch (e) {
      if (ac.signal.aborted) return;
      setAttempt({ state: "error", message: e instanceof JudgeNotConfigured ? "Add your OpenCode key in Settings to check readings." : e instanceof Error ? e.message : "Checking failed. Please try again." });
    }
  };
  const mic = useMicRecorder({ onRecorded: (file) => void check(file) });

  const hear = async () => {
    setSpeaking(true);
    try { await speakWord(word); }
    catch (e) { setAttempt({ state: "error", message: e instanceof Error ? e.message : "Couldn't play the word." }); }
    finally { setSpeaking(false); }
  };

  const status = mic.recording ? `Recording · ${mic.seconds}s. Say just “${word}”, then stop.`
    : attempt.state === "checking" ? "Checking…"
    : attempt.state === "done" ? (attempt.ok ? "That's it. Counted as a clean read." : "Not quite yet. Listen once more and try again.")
    : attempt.state === "error" ? attempt.message
    : mic.error || line;

  return <div className="flex flex-col gap-3 p-3.5">
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-serif text-[22px] font-medium">{word}</span>
      <span className={cn("text-[12px]", labelClass ?? "text-fg2")}>{label}</span>
    </div>
    <p role="status" className={cn("m-0 text-[13px]", attempt.state === "done" && attempt.ok ? "text-fg" : "text-fg2")}>{status}</p>
    <div className="grid grid-cols-2 gap-2.5">
      <Button variant="secondary" size="lg" className="!h-11 !bg-bg" loading={speaking} leading={<Volume2 size={16} aria-hidden />} onClick={() => void hear()}>Hear it</Button>
      <Button variant="primary" size="lg" className="!h-11" loading={mic.starting || attempt.state === "checking"}
        leading={mic.recording ? <Square size={14} fill="currentColor" aria-hidden /> : <Mic size={16} aria-hidden />}
        onClick={() => mic.recording ? mic.stop() : void mic.start()}>
        {mic.recording ? "Stop" : attempt.state === "done" || attempt.state === "error" ? "Try again" : "Try this word"}
      </Button>
    </div>
  </div>;
}
