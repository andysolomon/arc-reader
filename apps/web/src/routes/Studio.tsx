import { useEffect, useState } from "react";
import { NavLink, useParams, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button, VoiceSourceBadge, cn } from "@readaloud/ui";
import { voiceServiceColor } from "@readaloud/tokens";
import { VoiceWorkshop } from "../components/studio/VoiceWorkshop";
import { RerecordVoice } from "../components/studio/RerecordVoice";
import { VoiceGallery } from "../components/studio/VoiceGallery";
import { Transcription } from "../components/studio/Transcription";
import { Dubbing } from "../components/studio/Dubbing";
import { ModelTerms } from "../components/studio/ModelTerms";
import { ErrorNotice } from "../components/studio/shared";
import { studioJson } from "../lib/studio";

const TABS = [["gallery", "Voice gallery"], ["clone", "Clone"], ["design", "Design"], ["dub", "Dub video"], ["dictate", "Dictate"], ["transcribe", "Transcribe"]];
interface Check { label: string; value: string; ok: boolean }

/** What VoiceStudio is ready for, as one pill per capability. */
function Readiness() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setChecks(null);
    void Promise.all([
      studioJson<{ models_ready: boolean }>("/setup/status", { signal: ac.signal }),
      studioJson<{ ready: boolean }>("/dictation/readiness?purpose=transcribe", { signal: ac.signal }),
      studioJson<{ tts: { active: string; backends: { id: string; supports_cloning?: boolean }[] } }>("/engines", { signal: ac.signal }),
    ]).then(([models, asr, engines]) => {
      const cloning = !!engines.tts.backends.find((e) => e.id === engines.tts.active)?.supports_cloning;
      setChecks([
        { label: "Voice model", value: models.models_ready ? "installed" : "download required", ok: models.models_ready },
        { label: "Transcription", value: asr.ready ? "ready" : "model required", ok: asr.ready },
        { label: "Cloning engine", value: cloning ? "selected" : "select a cloning engine in VoiceStudio", ok: cloning },
      ]); setError("");
    }).catch((e: Error) => { if (!ac.signal.aborted) { setChecks([]); setError(e.message); } });
    return () => ac.abort();
  }, [revision]);
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      {!checks ? <p className="m-0 text-xs text-fg2">Checking VoiceStudio…</p> : error ? <p className="m-0 text-xs text-fg2">VoiceStudio is unavailable.</p> : checks.map((check) => (
        <span key={check.label} className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-bg2 px-2.5 py-1 text-xs text-fg2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: check.ok ? voiceServiceColor("VoiceStudio") : "var(--danger)" }} />
          <span className="text-fg">{check.label}</span>{check.value}
        </span>
      ))}
      <Button variant="ghost" pill className="ml-auto" leading={<RefreshCw size={14} strokeWidth={1.5} aria-hidden />} onClick={() => setRevision((r) => r + 1)}>Refresh status</Button>
    </div>
    <ErrorNotice error={error} />
  </div>;
}
export function StudioPage() {
  const { tool = "gallery" } = useParams();
  const selected = TABS.some(([id]) => id === tool) ? tool : "gallery";
  // Voices links "Re-record" here with the clone's id.
  const [params] = useSearchParams();
  const rerecording = selected === "clone" ? params.get("voice") : null;
  return <section data-screen="studio" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-40 sm:px-10 sm:pt-10 animate-fadein"><div className="mx-auto flex max-w-[960px] flex-col gap-5">
    <header className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3"><h1 className="m-0 font-serif text-[26px] font-medium">Studio</h1><VoiceSourceBadge source="VoiceStudio" /></div>
      <p className="m-0 text-fg2">Create a voice. Turn speech into text. Give your video a new voice.</p>
    </header>
    <nav aria-label="Studio tools" className="flex flex-wrap gap-2">{TABS.map(([id, label]) => <NavLink key={id} to={`/studio/${id}`} className={cn("inline-flex h-[34px] items-center rounded-pill border px-3.5 text-[13px]", selected === id ? "border-fg bg-fg text-bg hover:text-bg" : "border-line bg-bg2 text-fg hover:bg-bg3")}>{label}</NavLink>)}</nav>
    <Readiness />
    <ModelTerms />
    {selected === "gallery" ? <VoiceGallery /> : rerecording ? <RerecordVoice key={rerecording} id={rerecording} /> : selected === "clone" || selected === "design" ? <VoiceWorkshop key={selected} mode={selected} /> : selected === "dub" ? <Dubbing /> : <Transcription key={selected} dictate={selected === "dictate"} />}
  </div></section>;
}
