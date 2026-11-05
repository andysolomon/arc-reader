import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { VoiceCard } from "@readaloud/ui";
import { useVoices, getVoice, voiceLang, isLocalVoice } from "../state/voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { docs } from "../lib/db";
import { synthesize } from "../engine/providers";

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
    const v = getVoice(id);
    setPreviewing(id);
    const text = `Hi, I'm ${v.name}. This is how I sound at your current speed.`;
    const ac = new AbortController();
    abort.current = ac;
    const chunk = await synthesize({
      text,
      voice: v.id,
      engine: v.kind === "preset" ? v.engine : v.kind === "local" ? LOCAL_ENGINE : engineId,
      profile: v.kind === "profile",
      signal: ac.signal,
      forceLocal: isLocalVoice(v.id) || engineId === LOCAL_ENGINE || usePlayer.getState().offline,
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
    if (forDoc) {
      if (loadedDoc?.id === forDoc) await usePlayer.getState().setDocVoice(id);
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
          {VOICES.map((v) => (
            <VoiceCard key={v.id} voice={v} selected={current === v.id} previewing={previewing === v.id} onPreview={() => (previewing === v.id ? stopPreview() : void preview(v.id))} onSelect={() => void use(v.id)} />
          ))}
        </div>
      </div>
    </section>
  );
}
