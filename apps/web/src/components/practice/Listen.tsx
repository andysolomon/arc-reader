import { useEffect, useRef } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { Button } from "@readaloud/ui";
import { playClip, speakPassage } from "@readaloud/practice/speak";
import { useListen } from "@readaloud/practice/useListen";

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
