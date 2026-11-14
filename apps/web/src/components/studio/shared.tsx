import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, VoiceAvatar } from "@readaloud/ui";
import { useVoices } from "../../state/voices";
import { useMicRecorder } from "../../hooks/useMicRecorder";

export const fieldClass = "w-full rounded-control border border-line bg-bg px-3 py-2.5 text-fg";
export const panelClass = "rounded-panel border border-line bg-bg2 p-5 sm:p-6";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-2 text-sm"><span className="text-fg2">{label}</span>{children}</label>;
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? <p role="alert" className="rounded-control border border-line bg-bg3 p-3 text-sm text-danger">{error}</p> : null;
}
/** A saved voice's portrait, as Voices shows it; nothing until the voice list has it. */
export function SavedVoiceAvatar({ id, size = 52 }: { id: string; size?: number }) {
  const voice = useVoices((s) => s.voices.find((v) => v.id === id));
  return voice ? <VoiceAvatar voice={voice} size={size} /> : null;
}
export function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return;
    const ac = new AbortController(); controller.current = ac;
    setBusy(true); setError(""); setStatus("");
    try { await work(ac.signal); }
    catch (e) { if (!ac.signal.aborted) { setStatus(""); setError(e instanceof Error ? e.message : "Something went wrong."); } }
    finally { if (controller.current === ac) { controller.current = undefined; setBusy(false); } }
  };
  return { busy, error, setError, status, setStatus, run, cancel: () => { controller.current?.abort(); setStatus("Stopped waiting. Server tasks can be resumed."); } };
}

/** A complete, playable recording per take; tracks always close on stop or navigation. */
export function Recorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const mic = useMicRecorder({ onRecorded });
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={disabled && !mic.recording} loading={mic.starting} onClick={() => mic.recording ? mic.stop() : void mic.start()}>{mic.recording ? "Stop recording" : "Record microphone"}</Button>
      {mic.recording && <span role="status" className="text-sm text-fg2">Recording · {mic.seconds}s</span>}
    </div><ErrorNotice error={mic.error} />
  </div>;
}
export function LocalAudio({ file }: { file: File | null }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!file) { setUrl(""); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <audio className="w-full" controls src={url} aria-label="Recording preview" /> : null;
}
