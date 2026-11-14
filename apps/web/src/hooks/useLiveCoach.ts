import { useEffect, useMemo, useRef, useState } from "react";
import { encodeWav } from "../engine/audio";
import { JUDGE_SAMPLE_RATE, resample } from "../lib/practice/audio";
import { transcribeAudio } from "../lib/practice/judge";
import { LIVE_START, advanceLive, type LiveState } from "../lib/practice/live";
import { tokens } from "../lib/practice/words";
import type { Samples } from "./useMicRecorder";

/** A transcript needs this much audio to be worth asking for. */
const MIN_SECONDS = 2;
/** Rest between one transcript coming back and the next being asked for. */
const REST_MS = 1200;
/** After this many failures in a row the coach stays quiet for the rest of the take. */
const MAX_FAILURES = 3;

/**
 * Follows a reading as it is recorded: every couple of seconds the audio not yet settled goes to
 * the speech server, and the passage's words are marked as the reader gets to them. It is a
 * convenience on top of the final check, so any failure just leaves the passage unmarked.
 */
export function useLiveCoach(passage: string | null, recording: boolean, samplesSince: (seconds: number) => Samples | null): LiveState {
  const all = useMemo(() => (passage ? tokens(passage) : []), [passage]);
  const [state, setState] = useState<LiveState>(LIVE_START);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    setState(LIVE_START);
    if (!recording || !all.length) return;
    const ac = new AbortController();
    let busy = false, failures = 0, rested = 0;
    const tick = async () => {
      if (busy || failures >= MAX_FAILURES || Date.now() < rested) return;
      const heard = samplesSince(latest.current.audioFrom);
      if (!heard || heard.samples.length / heard.sampleRate < MIN_SECONDS) return;
      busy = true;
      try {
        const wav = encodeWav(resample(heard.samples, heard.sampleRate, JUDGE_SAMPLE_RATE), JUDGE_SAMPLE_RATE);
        // A busy server isn't waited for: the next tick asks again.
        const { segments } = await transcribeAudio(wav, "fast", ac.signal, 0);
        if (ac.signal.aborted) return;
        failures = 0;
        setState((prev) => advanceLive(prev, all, segments));
      } catch {
        failures++;
      } finally {
        busy = false;
        rested = Date.now() + REST_MS;
      }
    };
    const timer = setInterval(() => void tick(), 400);
    return () => { clearInterval(timer); ac.abort(); };
  }, [all, recording, samplesSince]);

  return state;
}
