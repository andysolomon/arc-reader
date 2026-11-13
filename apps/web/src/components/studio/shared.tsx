import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, VoiceAvatar } from "@readaloud/ui";
import { useVoices } from "../../state/voices";

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
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const mounted = useRef(true);
  const take = useRef(0);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; take.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }; }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  const start = async () => {
    setError(""); setStarting(true);
    const generation = ++take.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Microphone recording needs a supported browser and HTTPS.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || take.current !== generation) { media.getTracks().forEach((t) => t.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onerror = () => { setError("Recording failed. Please try again."); rec.onstop = null; media.getTracks().forEach((t) => t.stop()); setRecording(false); };
      rec.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current || take.current !== generation) return;
        setRecording(false);
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        if (chunks.length) onRecorded(new File(chunks, `recording.${ext}`, { type }));
      };
      rec.start(); setSeconds(0); setRecording(true);
    } catch (e) { stream.current?.getTracks().forEach((t) => t.stop()); if (mounted.current) setError(e instanceof Error ? e.message : "Microphone unavailable."); }
    finally { if (mounted.current) setStarting(false); }
  };
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={disabled && !recording} loading={starting} onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? "Stop recording" : "Record microphone"}</Button>
      {recording && <span role="status" className="text-sm text-fg2">Recording · {seconds}s</span>}
    </div><ErrorNotice error={error} />
  </div>;
}
export function LocalAudio({ file }: { file: File | null }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!file) { setUrl(""); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <audio className="w-full" controls src={url} aria-label="Recording preview" /> : null;
}
