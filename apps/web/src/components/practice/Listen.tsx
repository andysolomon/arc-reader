import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { Button } from "@readaloud/ui";
import { playClip, speakPassage } from "../../lib/practice/speak";

type Kind = "mine" | "voice";
type Playing = { kind: Kind; ready: boolean } | null;

/** One thing playing at a time; pressing what's playing stops it. */
function useListen() {
  const [playing, setPlaying] = useState<Playing>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => { controller.current?.abort(); setPlaying(null); }, []);
  const toggle = async (kind: Kind, run: (signal: AbortSignal, ready: () => void) => Promise<unknown>) => {
    const wasPlaying = playing?.kind === kind;
    stop();
    if (wasPlaying) return;
    const ac = new AbortController(); controller.current = ac;
    setError(""); setPlaying({ kind, ready: false });
    try { await run(ac.signal, () => { if (!ac.signal.aborted) setPlaying({ kind, ready: true }); }); }
    catch (e) { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Couldn't play that."); }
    finally { if (controller.current === ac) setPlaying(null); }
  };
  return { playing, error, stop, toggle };
}

const stopIcon = <Square size={14} fill="currentColor" aria-hidden />;

/**
 * Under a scored reading: the reader's own take, and the passage in the chosen voice, to compare.
 * The take lives only as long as these results.
 */
export function ListenPanel({ text, recording }: { text: string; recording: Blob }) {
  const { playing, error, toggle } = useListen();
  const mine = playing?.kind === "mine";
  const voice = playing?.kind === "voice";
  return <section aria-label="Listen" className="flex flex-col gap-2">
    <div className="grid grid-cols-2 gap-2.5">
      <Button variant="secondary" size="lg" aria-pressed={mine} leading={mine ? stopIcon : <Play size={16} aria-hidden />}
        onClick={() => void toggle("mine", async (signal, ready) => { ready(); await playClip(recording, signal); })}>
        {mine ? "Stop" : "Your reading"}
      </Button>
      <Button variant="secondary" size="lg" aria-pressed={voice} leading={voice ? stopIcon : <Volume2 size={16} aria-hidden />}
        onClick={() => void toggle("voice", (signal, ready) => speakPassage(text, signal, ready))}>
        {voice ? (playing.ready ? "Stop" : "Preparing…") : "Hear it read"}
      </Button>
    </div>
    {error && <p role="alert" className="m-0 text-[13px] text-fg2">{error}</p>}
  </section>;
}

/** A small "Listen" in the passage's head while reading, for hearing it once before trying. Stops when recording starts. */
export function HearPassageButton({ text, disabled, onError }: { text: string; disabled?: boolean; onError: (message: string) => void }) {
  const { playing, error, stop, toggle } = useListen();
  useEffect(() => { if (disabled) stop(); }, [disabled, stop]);
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => { if (error) report.current(error); }, [error]);
  const on = !!playing;
  return <Button size="sm" variant="ghost" disabled={disabled} aria-pressed={on}
    leading={on ? stopIcon : <Volume2 size={15} aria-hidden />}
    onClick={() => void toggle("voice", (signal, ready) => speakPassage(text, signal, ready))}>
    {on ? (playing.ready ? "Stop" : "Preparing…") : "Listen"}
  </Button>;
}
