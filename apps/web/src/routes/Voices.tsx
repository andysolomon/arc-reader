import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { VoiceCard } from "@readaloud/ui";
import { useVoices, getVoice, voiceLang, isLocalVoice } from "../state/voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { docs } from "../lib/db";
import { synthesize, DEFAULT_ENGINE } from "../engine/providers";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { preparePatois } from "../lib/patois";

const PREVIEW_MS = 3000;

export function VoicesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forDoc = params.get("for");
  const selected = useSettings((s) => s.voice);
  const set = useSettings((s) => s.set);
  const engineId = useSettings((s) => s.engine);
  const VOICES = useVoices((s) => s.voices);
  const reload = useVoices((s) => s.load);
  const fishError = useVoices((s) => s.fishError);
  const speed = usePlayer((s) => s.speed);
  const loadedDoc = usePlayer((s) => s.doc);
  const docVoice = usePlayer((s) => s.voiceId);
  const hasDoc = !!loadedDoc;
  const [docTitle, setDocTitle] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!forDoc) return;
    if (loadedDoc?.id === forDoc) setDocTitle(loadedDoc.title);
    else void docs.get(forDoc).then((r) => setDocTitle(r?.title ?? null));
  }, [forDoc, loadedDoc]);

  const stopPreview = () => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    audio.current?.pause();
    if (audio.current?.src.startsWith("blob:")) URL.revokeObjectURL(audio.current.src);
    audio.current = null;
    window.speechSynthesis?.cancel();
    setPreviewing(null);
  };
  useEffect(() => stopPreview, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const preview = async (id: string) => {
    stopPreview();
    usePlayer.getState().clearOffline();
    const v = getVoice(id);
    setPreviewing(id);
    let text = `Hi, I'm ${v.name}. This is how I sound at your current speed.`;
    const ac = new AbortController();
    abort.current = ac;
    if (id === JAMAICAN_PATOIS_VOICE_ID) {
      try {
        const sample = await preparePatois({ id: "preview", title: "Preview", text, voice: id, source: "sample", domain: "Sample", chars: text.length, createdAt: 0, updatedAt: 0 }, ac.signal, () => {});
        text = sample.patois!.text;
      } catch (error) {
        if (!ac.signal.aborted) { toast(error instanceof Error ? error.message : "Patois preview failed"); stopPreview(); }
        return;
      }
    }
    const chunk = await synthesize({
      text,
      voice: v.id,
      engine: v.engine,
      profile: v.kind === "profile",
      signal: ac.signal,
      forceLocal: isLocalVoice(v.id) || (v.kind === "profile" && engineId === LOCAL_ENGINE),
      onOffline: () => usePlayer.setState({ offline: true }),
      onRejected: (m) => toast(m),
    }).catch(() => null);
    if (ac.signal.aborted) return;
    if (chunk?.audio) {
      const a = new Audio(URL.createObjectURL(chunk.audio));
      a.playbackRate = speed;
      a.onended = stopPreview;
      audio.current = a;
      a.play().catch(() => toast("Tap preview again to hear it"));
    } else if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voiceLang(v);
      u.rate = speed;
      u.onend = () => setPreviewing((p) => (p === id ? null : p));
      window.speechSynthesis.speak(u);
    }
    timer.current = setTimeout(stopPreview, PREVIEW_MS);
  };

  const use = async (id: string) => {
    const v = getVoice(id);
    if (v.kind === "preset" && engineId === LOCAL_ENGINE) set("engine", DEFAULT_ENGINE);
    usePlayer.getState().clearOffline();
    if (forDoc) {
      if (loadedDoc?.id === forDoc) {
        if (!await usePlayer.getState().setDocVoice(id)) return;
      }
      else {
        const rec = await docs.get(forDoc);
        if (rec) await docs.put({ ...rec, voice: id, updatedAt: Date.now() });
      }
      void useLibrary.getState().refresh();
      toast(`${v.name} will read “${docTitle ?? "this document"}”`);
      navigate(-1);
      return;
    }
    set("voice", id);
    toast(`${v.name} selected`);
  };

  const current = forDoc ? (loadedDoc?.id === forDoc ? docVoice : selected) : selected;

  return (
    <section data-screen="voices" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: hasDoc ? 160 : 64 }}>
      <div className="mx-auto flex max-w-[880px] flex-col gap-5">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="m-0 font-serif text-[26px] font-medium">Voices</h1>
          <span className="text-fg2">
            {forDoc ? `Choosing a voice for “${docTitle ?? "this document"}”.` : "Selected voice is remembered. Override per document from the player menu."}
          </span>
        </div>
        {fishError && (
          <div role="status" className="rounded-panel border border-line bg-bg2 p-4 text-[13px] text-fg2">
            Fish Audio voices could not refresh: {fishError}. Your other voices are still available.
            <button type="button" onClick={() => void reload()} className="ml-2 border-0 bg-transparent text-accent underline">Retry</button>
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm underline"><Link to="/studio/clone">Clone a voice</Link><Link to="/studio/design">Design a voice</Link><Link to="/studio/gallery">Browse designed voices</Link></div>
        {VOICES.some((v) => v.id === JAMAICAN_PATOIS_VOICE_ID) && <p className="text-sm text-fg2">Jamaican English reads your original wording. Jamaican Patois rewrites English into Patois before reading, using OpenAI for the rewrite and Fish Audio for speech. Your original is kept.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
          {VOICES.map((v) => (
            <VoiceCard key={v.id} voice={v} selected={current === v.id} previewing={previewing === v.id} onPreview={() => (previewing === v.id ? stopPreview() : void preview(v.id))} onSelect={() => void use(v.id)} />
          ))}
        </div>
      </div>
    </section>
  );
}
