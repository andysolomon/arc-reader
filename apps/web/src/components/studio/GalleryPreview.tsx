import { useEffect, useState } from "react";
import { Button } from "@readaloud/ui";
import { idPath, studioFetch, studioJson, type PreviewSource } from "../../lib/studio";
import { ErrorNotice, panelClass } from "./shared";

const TIMEOUT_MS = 180_000;

export function GalleryPreview({ id, name, onClose, onReady }: { id: string; name: string; onClose: () => void; onReady: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("Checking preview…");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    let objectUrl = "";
    let timedOut = false;
    const started = Date.now();
    setUrl(""); setError(""); setElapsed(0); setStatus("Checking preview…");
    const clock = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const timeout = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT_MS);
    const path = `/archetypes/${idPath(id)}/preview`;
    void (async () => {
      try {
        const state = await studioJson<PreviewSource>(`${path}/state`, { signal: ac.signal, cache: "no-cache" });
        if (state.source === "no_model") throw new Error(state.message);
        setStatus(state.source === "rendering"
          ? "Generating preview on your machine. The first preview can take a minute or more on CPU; later plays use the saved audio."
          : "Loading saved preview…");
        // Revalidate the server's saved clip on every open so a repaired
        // preview replaces bad audio without needing a full page reload.
        const response = await studioFetch(path, { signal: ac.signal, cache: "no-cache" });
        if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("VoiceStudio returned an invalid audio response. Please retry.");
        const clip = await response.blob();
        if (!clip.size) throw new Error("VoiceStudio returned an empty preview. Please retry.");
        if (ac.signal.aborted) return;
        objectUrl = URL.createObjectURL(clip);
        onReady(id);
        setUrl(objectUrl); setStatus("Preview ready. Press play if it doesn’t start automatically.");
      } catch (e) {
        if (timedOut) setError("This preview is taking longer than expected. VoiceStudio may still finish in the background. Retry to check for the saved audio.");
        else if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Could not load the preview.");
      } finally { clearInterval(clock); clearTimeout(timeout); }
    })();
    return () => { ac.abort(); clearInterval(clock); clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, attempt, onReady]);
  return <div className={`${panelClass} flex flex-col gap-3`}>
    <p className="text-sm">Preview · {name}</p>
    {!error && <p role="status" className="text-sm text-fg2">{status}{!url && elapsed > 0 ? ` · ${elapsed}s elapsed` : ""}</p>}
    {url && <audio controls autoPlay className="w-full" src={url} aria-label={`Preview ${name}`} onError={() => setError("Your browser could not play this audio. Retry the preview.")} />}
    <ErrorNotice error={error} />
    <div className="flex gap-3">{error && <Button onClick={() => setAttempt((n) => n + 1)}>Retry preview</Button>}<Button onClick={onClose}>Close preview</Button></div>
  </div>;
}
