import { useCallback, useEffect, useRef, useState } from "react";

export interface MicRecorderOptions {
  onRecorded: (file: File) => void;
  /** Keep a rolling list of this many input levels (0–1) for a meter; 0 skips the analyser. */
  meterBars?: number;
}

/**
 * A complete, playable recording per take. Tracks always close on stop, error and unmount, and a
 * take that finishes after the component moved on is dropped.
 */
export function useMicRecorder({ onRecorded, meterBars = 0 }: MicRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(meterBars).fill(0));
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const meter = useRef<{ context: AudioContext; frame: number } | null>(null);
  const mounted = useRef(true);
  const take = useRef(0);
  const report = useRef(onRecorded);
  report.current = onRecorded;

  const stopMeter = useCallback(() => {
    if (!meter.current) return;
    cancelAnimationFrame(meter.current.frame);
    void meter.current.context.close().catch(() => undefined);
    meter.current = null;
  }, []);

  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; take.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stopMeter();
  }; }, [stopMeter]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const startMeter = (media: MediaStream) => {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!meterBars || !Context) return;
    try {
      const context = new Context();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (time: number) => {
        if (!meter.current) return;
        meter.current.frame = requestAnimationFrame(tick);
        if (time - last < 70) return;
        last = time;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
        setLevels((prev) => [...prev.slice(1), level]);
      };
      meter.current = { context, frame: requestAnimationFrame(tick) };
    } catch { meter.current = null; }
  };

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
      rec.onerror = () => { setError("Recording failed. Please try again."); rec.onstop = null; media.getTracks().forEach((t) => t.stop()); stopMeter(); setRecording(false); };
      rec.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        stopMeter();
        if (!mounted.current || take.current !== generation) return;
        setRecording(false);
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        if (chunks.length) report.current(new File(chunks, `recording.${ext}`, { type }));
      };
      rec.start(); setSeconds(0); setLevels(Array(meterBars).fill(0)); setRecording(true);
      startMeter(media);
    } catch (e) { stream.current?.getTracks().forEach((t) => t.stop()); if (mounted.current) setError(e instanceof Error ? e.message : "Microphone unavailable."); }
    finally { if (mounted.current) setStarting(false); }
  };

  const stop = () => recorder.current?.stop();
  /** Throw the current take away without reporting it. */
  const discard = () => { take.current++; if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach((t) => t.stop()); stopMeter(); setRecording(false); };
  return { recording, starting, error, seconds, levels, start, stop, discard };
}
