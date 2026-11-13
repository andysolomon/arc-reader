import { useEffect, useState } from "react";
import { Button, VoiceAvatar, VoiceServiceName, type PortraitVoice } from "@readaloud/ui";
import { usePreviews } from "../../state/previews";
import { ErrorNotice, panelClass } from "./shared";

export function GalleryPreview({ id, name, voice }: { id: string; name: string; /** Shows whose sample this is; left out when the recipe is no longer on screen. */ voice?: PortraitVoice }) {
  const job = usePreviews((s) => s.jobs[id]);
  const { retry, close, markPlayed, fail } = usePreviews.getState();
  const [now, setNow] = useState(Date.now());
  const waiting = !!job && !job.done;
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [waiting]);
  if (!job) return null;
  const elapsed = Math.max(0, Math.floor((now - job.startedAt) / 1000));
  return <div className={`${panelClass} flex flex-col gap-3`}>
    <div className="flex items-center gap-3">
      {voice && <VoiceAvatar voice={voice} size={44} />}
      <p className="m-0 text-sm">Preview · <VoiceServiceName source="VoiceStudio">{name}</VoiceServiceName></p>
    </div>
    {!job.error && <p role="status" className="text-sm text-fg2">{job.status}{waiting && elapsed > 0 ? ` · ${elapsed}s elapsed` : ""}</p>}
    {/* Autoplay once, so returning to Studio after it finished doesn't replay it. */}
    {job.url && <audio controls autoPlay={!job.played} className="w-full" src={job.url} aria-label={`Preview ${name}`} onPlay={() => markPlayed(id)} onError={() => fail(id, "Your browser could not play this audio. Retry the preview.")} />}
    <ErrorNotice error={job.error} />
    <div className="flex gap-3">{job.error && <Button onClick={() => retry(id)}>Retry preview</Button>}<Button onClick={close}>Close preview</Button></div>
  </div>;
}
