import { useEffect, useRef, useState } from "react";
import { prepareTake } from "./audio";
import { judgeWord } from "./judge";
import { speakWord, stopPlayback } from "./speak";
import { useMicRecorder } from "./useMicRecorder";

export type Attempt = { state: "idle" } | { state: "checking" } | { state: "done"; ok: boolean; heard?: string } | { state: "error"; message: string };

/**
 * "Hear it" and "Try this word" for one word. Trying records just the word and checks it against
 * a transcript of the clip; `onClean` runs when it was read cleanly. `line` is the help shown
 * until something happens.
 */
export function useWordAttempt(word: string, line: string, onClean: (word: string) => void) {
  const [attempt, setAttempt] = useState<Attempt>({ state: "idle" });
  const [speaking, setSpeaking] = useState(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);

  const check = async (file: File) => {
    controller.current?.abort();
    const ac = new AbortController(); controller.current = ac;
    setAttempt({ state: "checking" });
    try {
      const take = await prepareTake(file);
      const { result, heard } = await judgeWord(word, take, ac.signal);
      if (ac.signal.aborted) return;
      // Only a clean read counts: a lone word is too easily misheard to hold a miss against the reader.
      if (result === "correct") onClean(word);
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

  return {
    attempt, status, speaking, hear,
    recording: mic.recording,
    /** The microphone is starting or the clip is being checked. */
    busy: mic.starting || attempt.state === "checking",
    /** Start a take, or stop the one being recorded. */
    toggle: () => mic.recording ? mic.stop() : record(),
    /** The record button's words. */
    action: mic.recording ? "Stop" : attempt.state === "done" || attempt.state === "error" ? "Try again" : "Try this word",
  };
}
