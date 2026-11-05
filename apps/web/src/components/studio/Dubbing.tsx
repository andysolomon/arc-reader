import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@readaloud/ui";
import { studioJson, studioUrl, jsonBody, idPath, waitForTask, type Segment, type Profile } from "../../lib/studio";
import { ErrorNotice, Field, fieldClass, panelClass, useOperation } from "./shared";

const KEY = "readaloud:dub-draft:v1";
const LANGUAGES = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["ja", "Japanese"], ["zh", "Chinese"], ["hi", "Hindi"], ["ar", "Arabic"]];
interface Draft { jobId: string; filename: string; segments: Segment[]; taskId?: string; stage: "preparing" | "ready" | "rendering" | "done"; language: string; renderedLanguage?: string; profile: string }
function restore(): Draft | null { try { const d = JSON.parse(localStorage.getItem(KEY) || "null") as Draft | null; return d && typeof d.jobId === "string" && Array.isArray(d.segments) ? d : null; } catch { return null; } }
export function Dubbing() {
  const [draft, setDraft] = useState<Draft | null>(restore);
  const [file, setFile] = useState<File | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesError, setProfilesError] = useState("");
  const [provider, setProvider] = useState("manual");
  const [preserve, setPreserve] = useState(true);
  const [storageError, setStorageError] = useState("");
  const op = useOperation();
  useEffect(() => {
    const ac = new AbortController();
    void studioJson<Profile[]>("/profiles", { signal: ac.signal }).then(setProfiles).catch((e: Error) => { if (!ac.signal.aborted) setProfilesError(e.message); });
    return () => ac.abort();
  }, []);
  useEffect(() => {
    try { if (draft) localStorage.setItem(KEY, JSON.stringify(draft)); else localStorage.removeItem(KEY); setStorageError(""); }
    catch { setStorageError("This browser cannot save your dubbing draft. Keep this page open until the download is ready."); }
  }, [draft]);
  const update = (patch: Partial<Draft>) => setDraft((d) => d ? { ...d, ...patch } : d);
  const finishTask = async (d: Draft, signal: AbortSignal) => {
    if (!d.taskId) return;
    await waitForTask(d.taskId, signal, op.setStatus, d.stage === "preparing" ? "ready" : "done");
    update({ stage: d.stage === "preparing" ? "ready" : "done", taskId: undefined });
    op.setStatus(d.stage === "preparing" ? "Video ready. Transcribe it or import subtitles." : "Dub ready to download.");
  };
  const upload = () => op.run(async (signal) => {
    if (!file) return;
    op.setStatus("Uploading and preparing video…");
    const body = new FormData(); body.set("video", file);
    const job = await studioJson<{ job_id: string; task_id: string }>("/dub/upload", { method: "POST", body, signal });
    const next: Draft = { jobId: job.job_id, taskId: job.task_id, filename: file.name, segments: [], stage: "preparing", language: "en", profile: profiles[0]?.id || "" };
    setDraft(next); await finishTask(next, signal);
  });
  const segmentIds = draft?.segments.map((s, i) => String(s.id ?? `seg_${i}`)) || [];
  const editable = !!draft && !op.busy && !draft.taskId;
  return <div className="flex flex-col gap-5">
    <div className={`${panelClass} flex flex-col gap-4`}>
      <div><h2 className="font-serif text-xl">Dub a video</h2><p className="mt-2 text-sm text-fg2">Upload, review the timed script, choose a saved voice, and render a new audio track into your video.</p></div>
      {!draft ? <><Field label="Video file"><input className={fieldClass} type="file" accept="video/*" disabled={op.busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field><Button className="self-start" variant="primary" disabled={!file} loading={op.busy} onClick={() => void upload()}>Upload video</Button></> : <>
        <p className="break-all text-sm">{draft.filename} · {draft.stage}</p>
        {draft.taskId && !op.busy && <Button className="self-start" onClick={() => void op.run((signal) => finishTask(draft, signal))}>Resume progress</Button>}
        {draft.stage !== "preparing" && <video className="max-h-72 w-full rounded-control bg-black" controls preload="metadata" src={studioUrl(`/dub/media/${idPath(draft.jobId)}`)} aria-label="Source video" />}
        <div className="flex flex-wrap gap-3">
          <Button disabled={!editable} loading={op.busy} onClick={() => void op.run(async (signal) => {
            op.setStatus("Transcribing video…");
            const result = await studioJson<{ segments: Segment[]; source_lang?: string }>(`/dub/transcribe/${idPath(draft.jobId)}`, { method: "POST", signal });
            update({ segments: result.segments, stage: "ready", renderedLanguage: undefined, language: LANGUAGES.some(([code]) => code === result.source_lang) ? result.source_lang! : draft.language });
            op.setStatus(result.segments.length ? "Review and edit the script below." : "No speech detected. Import subtitles to provide a script.");
          })}>Transcribe video</Button>
          <Button disabled={op.busy || !!draft.taskId} onClick={() => { setDraft(null); setFile(null); op.setStatus(""); }}>Start another video</Button>
          {op.busy && <Button onClick={op.cancel}>Stop waiting</Button>}
          {draft.taskId && !op.busy && <Button onClick={() => void op.run(async (signal) => {
            await studioJson(`/tasks/cancel/${idPath(draft.taskId!)}`, { method: "POST", signal });
            await studioJson(`/dub/abort/${idPath(draft.jobId)}`, { method: "POST", signal });
            update({ taskId: undefined, stage: "ready", renderedLanguage: undefined }); op.setStatus("Job cancelled.");
          })}>Cancel server job</Button>}
        </div>
        <Field label="Or import timed subtitles (SRT or VTT)"><input className={fieldClass} type="file" accept=".srt,.vtt" disabled={!editable} onChange={(e) => {
          const subtitle = e.target.files?.[0]; e.target.value = "";
          if (!subtitle) return;
          void op.run(async (signal) => { const body = new FormData(); body.set("file", subtitle); const result = await studioJson<{ segments: Segment[] }>(`/dub/import-srt/${idPath(draft.jobId)}`, { method: "POST", body, signal }); update({ segments: result.segments, stage: "ready", renderedLanguage: undefined }); op.setStatus("Subtitles imported."); });
        }} /></Field>
      </>}
      <p role="status" className="text-sm text-fg2">{op.status}</p><ErrorNotice error={op.error || profilesError || storageError} />
    </div>
    {draft && draft.segments.length > 0 && <div className={`${panelClass} flex flex-col gap-5`}>
      <h3 className="font-serif text-xl">Script & voice</h3>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Dub language"><select className={fieldClass} value={draft.language} disabled={!editable} onChange={(e) => update({ language: e.target.value })}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></Field>
      <Field label="Saved voice"><select className={fieldClass} value={draft.profile} disabled={!editable} onChange={(e) => update({ profile: e.target.value })}><option value="">Choose a voice</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
      {profiles.length === 0 && <Link to="/studio/clone" className="text-sm underline">Clone or design a voice first</Link>}
      <Field label="Translation"><select className={fieldClass} disabled={!editable} value={provider} onChange={(e) => setProvider(e.target.value)}><option value="manual">Keep script / edit manually</option><option value="google">Google Translate — sends transcript online</option></select></Field>
      {provider !== "manual" && <Button className="self-start" disabled={!editable} onClick={() => void op.run(async (signal) => {
        op.setStatus("Translating script…");
        const result = await studioJson<{ translated: { id: string; text: string; error?: string }[] }>("/dub/translate", { ...jsonBody({ job_id: draft.jobId, target_lang: draft.language, provider, segments: draft.segments.map((s, i) => ({ ...s, id: segmentIds[i] })) }), signal });
        const error = result.translated.find((s) => s.error); if (error) throw new Error(`Translation failed: ${error.error}`);
        const translated = new Map(result.translated.map((s) => [s.id, s.text]));
        if (segmentIds.some((id) => !translated.has(id))) throw new Error("Translation returned an incomplete script. Your original script has been kept.");
        update({ segments: draft.segments.map((s, i) => ({ ...s, text: translated.get(segmentIds[i])! })), stage: "ready", renderedLanguage: undefined }); op.setStatus("Translation ready for review.");
      })}>Translate script</Button>}
      <div className="flex max-h-[460px] flex-col gap-3 overflow-y-auto">
        {draft.segments.map((segment, i) => <Field key={segmentIds[i]} label={`Line ${i + 1} · ${segment.start.toFixed(1)}–${segment.end.toFixed(1)}s`}><textarea rows={2} className={fieldClass} disabled={!editable} value={segment.text} onChange={(e) => update({ segments: draft.segments.map((s, j) => i === j ? { ...s, text: e.target.value } : s), stage: "ready", renderedLanguage: undefined })} /></Field>)}
      </div>
      <Button className="self-start" variant="primary" disabled={!editable || !draft.profile || !draft.segments.some((s) => s.text.trim())} onClick={() => void op.run(async (signal) => {
        op.setStatus("Starting dub render…");
        const result = await studioJson<{ task_id: string }>(`/dub/generate/${idPath(draft.jobId)}`, { ...jsonBody({ segments: draft.segments.map((s) => ({ ...s, profile_id: draft.profile })), segment_ids: segmentIds, language: LANGUAGES.find(([code]) => code === draft.language)?.[1], language_code: draft.language, timing_strategy: "strict_slot" }), signal });
        const next = { ...draft, taskId: result.task_id, stage: "rendering" as const, renderedLanguage: draft.language }; setDraft(next); await finishTask(next, signal);
      })}>Render dubbed video</Button>
    </div>}
    {draft?.stage === "done" && draft.renderedLanguage && <div className={`${panelClass} flex flex-col gap-4`}><h3 className="font-serif text-xl">Your dub is ready</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preserve} onChange={(e) => setPreserve(e.target.checked)} />Preserve background audio</label>
      <div className="flex flex-wrap gap-4 text-sm underline">{[["download", "Download video"], ["download-audio", "Download audio"], ["srt", "Download subtitles"]].map(([route, label]) => <a key={route} href={studioUrl(`/dub/${route}/${idPath(draft.jobId)}?lang=${idPath(draft.renderedLanguage!)}&preserve_bg=${preserve}${route === "download" ? `&default_track=${idPath(draft.renderedLanguage!)}&include_tracks=${idPath(draft.renderedLanguage!)}` : ""}`)} download>{label}</a>)}</div>
    </div>}
  </div>;
}
