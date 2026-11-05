import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Button, cn } from "@readaloud/ui";
import { VoiceWorkshop, VoiceGallery } from "../components/studio/VoiceWorkshop";
import { Transcription } from "../components/studio/Transcription";
import { Dubbing } from "../components/studio/Dubbing";
import { ModelTerms } from "../components/studio/ModelTerms";
import { ErrorNotice } from "../components/studio/shared";
import { studioJson } from "../lib/studio";

const TABS = [["gallery", "Voice gallery"], ["clone", "Clone"], ["design", "Design"], ["dub", "Dub video"], ["dictate", "Dictate"], ["transcribe", "Transcribe"]];
function Readiness() {
  const [message, setMessage] = useState("Checking VoiceStudio…");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    void Promise.all([
      studioJson<{ models_ready: boolean }>("/setup/status", { signal: ac.signal }),
      studioJson<{ ready: boolean }>("/dictation/readiness?purpose=transcribe", { signal: ac.signal }),
      studioJson<{ tts: { active: string; backends: { id: string; supports_cloning?: boolean }[] } }>("/engines", { signal: ac.signal }),
    ]).then(([models, asr, engines]) => {
      const cloning = engines.tts.backends.find((e) => e.id === engines.tts.active)?.supports_cloning;
      setMessage(`Voice model: ${models.models_ready ? "installed" : "download required"} · Transcription: ${asr.ready ? "ready" : "model required"} · Cloning engine: ${cloning ? "selected" : "select a cloning engine in VoiceStudio"}`); setError("");
    }).catch((e: Error) => { if (!ac.signal.aborted) { setMessage("VoiceStudio is unavailable."); setError(e.message); } });
    return () => ac.abort();
  }, [revision]);
  return <div className="rounded-control border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-fg2">{message}</p><Button variant="ghost" onClick={() => setRevision((r) => r + 1)}>Refresh status</Button></div><ErrorNotice error={error} /></div>;
}
export function StudioPage() {
  const { tool = "gallery" } = useParams();
  const selected = TABS.some(([id]) => id === tool) ? tool : "gallery";
  return <section data-screen="studio" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-40 sm:px-10 sm:pt-10 animate-fadein"><div className="mx-auto flex max-w-[960px] flex-col gap-6">
    <header><h1 className="font-serif text-[28px] font-medium">Studio</h1><p className="mt-2 text-fg2">Create a voice. Turn speech into text. Give your video a new voice.</p></header>
    <nav aria-label="Studio tools" className="flex flex-wrap gap-2">{TABS.map(([id, label]) => <NavLink key={id} to={`/studio/${id}`} className={cn("rounded-control border px-3 py-2 text-sm", selected === id ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg2 text-fg2 hover:bg-bg3")}>{label}</NavLink>)}</nav>
    <Readiness />
    <ModelTerms />
    {selected === "gallery" ? <VoiceGallery /> : selected === "clone" || selected === "design" ? <VoiceWorkshop key={selected} mode={selected} /> : selected === "dub" ? <Dubbing /> : <Transcription key={selected} dictate={selected === "dictate"} />}
  </div></section>;
}
