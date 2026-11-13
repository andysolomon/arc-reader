import { useEffect, useState } from "react";
import { NavLink, useParams, useSearchParams } from "react-router-dom";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { IconButton, VoiceSourceBadge, cn } from "@readaloud/ui";
import { useIsTouch } from "../hooks/useMedia";
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

/** What VoiceStudio is ready for, one check per capability; `checks` is null while asking. */
function useReadiness() {
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
  return { checks, error, refresh: () => setRevision((r) => r + 1) };
}

const TAB = "inline-flex h-[34px] shrink-0 items-center rounded-pill border px-3.5 text-[13px]";

export function StudioPage() {
  const { tool = "gallery" } = useParams();
  const selected = TABS.some(([id]) => id === tool) ? tool : "gallery";
  // Voices links "Re-record" here with the clone's id.
  const [params] = useSearchParams();
  const rerecording = selected === "clone" ? params.get("voice") : null;
  const touch = useIsTouch();
  const { checks, error, refresh } = useReadiness();
  const problems = checks?.filter((check) => !check.ok) ?? [];
  // Readiness is the status icon's to show; what is missing is spelled out.
  const summary = !checks ? "Checking VoiceStudio…" : error ? "VoiceStudio is unavailable." : checks.map((check) => `${check.label} ${check.value}`).join(" · ");
  return <section data-screen="studio" className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-40 sm:px-10 sm:pt-10 animate-fadein"><div className="mx-auto flex max-w-[960px] flex-col gap-4">
    <header className="flex items-center gap-3">
      <h1 className="m-0 font-serif text-[26px] font-medium">Studio</h1>
      <VoiceSourceBadge source="VoiceStudio" />
      <IconButton label="Refresh VoiceStudio status" title={`${summary}\nRefresh status`} size={touch ? 44 : 36} disabled={!checks} onClick={refresh} className={cn("-mr-2 ml-auto sm:mr-0", (error || problems.length > 0) && "text-danger")}>
        {!checks ? <LoaderCircle size={touch ? 20 : 18} strokeWidth={1.5} className="animate-spin motion-reduce:animate-none" />
          : error || problems.length ? <CircleAlert size={touch ? 20 : 18} strokeWidth={1.5} /> : <CircleCheck size={touch ? 20 : 18} strokeWidth={1.5} />}
      </IconButton>
    </header>
    <p role="status" aria-label="VoiceStudio readiness" className={cn("m-0 flex flex-wrap items-center gap-2 text-xs text-fg2", !error && !problems.length && "sr-only")}>
      {error ? "VoiceStudio is unavailable." : (problems.length ? problems : checks ?? []).map((check) => (
        <span key={check.label} className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-bg2 px-2.5 py-1">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: check.ok ? voiceServiceColor("VoiceStudio") : "var(--danger)" }} />
          <span className="text-fg">{check.label}</span>{check.value}
        </span>
      ))}
      {!checks && "Checking VoiceStudio…"}
    </p>
    <ErrorNotice error={error} />
    {/* One row that scrolls sideways on a phone, so the tool's content starts right below it. */}
    <nav aria-label="Studio tools" className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">{TABS.map(([id, label]) => <NavLink key={id} to={`/studio/${id}`} className={cn(TAB, selected === id ? "border-fg bg-fg text-bg hover:text-bg" : "border-line bg-bg2 text-fg hover:bg-bg3")}>{label}</NavLink>)}</nav>
    <ModelTerms />
    {selected === "gallery" ? <VoiceGallery /> : rerecording ? <RerecordVoice key={rerecording} id={rerecording} /> : selected === "clone" || selected === "design" ? <VoiceWorkshop key={selected} mode={selected} /> : selected === "dub" ? <Dubbing /> : <Transcription key={selected} dictate={selected === "dictate"} />}
  </div></section>;
}
