import { usePlayer } from "../state/player";
import { getVoice } from "../data/voices";

/** One polite live region: "Playing/Paused — {voice}, {speed}×". */
export function LiveRegion() {
  const doc = usePlayer((s) => s.doc);
  const playing = usePlayer((s) => s.playing);
  const speed = usePlayer((s) => s.speed);
  const voice = getVoice(usePlayer((s) => s.voiceId));
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only-live">
      {doc ? `${playing ? "Playing" : "Paused"} — ${voice.name}, ${Number(speed.toFixed(2))}×` : ""}
    </div>
  );
}
