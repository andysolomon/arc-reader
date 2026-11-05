import { useMemo, useState } from "react";
import { Button, Dialog, Input, ProgressRing, VoiceServiceName, cn } from "@readaloud/ui";
import { Search, Zap } from "lucide-react";
import { voiceSource } from "../data/voices";
import { baseFor, isPaidEngine } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
import { isPreparing, PREPARATION_CONCURRENCY, usePreparation } from "../state/preparation";
import { getVoice, useVoices } from "../state/voices";
import { useSettings } from "../state/settings";
import { toast } from "../state/toast";
import type { LibraryItem } from "../state/library";

export function PreparedStatus({ it, defaultVoice, onPrepare }: { it: LibraryItem; defaultVoice: string; onPrepare: () => void }) {
  const jobs = usePreparation((s) => s.jobs);
  const openaiModel = useSettings((s) => s.openaiModel);
  useVoices((s) => s.voices);
  const voiceId = it.rec.voice ?? defaultVoice;
  const prepared = [...it.prepared];
  for (const job of jobs) {
    if (job.docId === it.rec.id && isPreparing(job) && !prepared.some((v) => v.voiceId === job.voice.id)) prepared.push({ voiceId: job.voice.id, name: job.voice.name, engine: job.voice.engine, fraction: 0 });
  }
  if (!prepared.some((v) => v.voiceId === voiceId) && voiceId !== "local") {
    const voice = getVoice(voiceId);
    prepared.unshift({ voiceId, name: voice.name, engine: voice.engine, fraction: 0 });
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Prepared audio">
      {prepared.length === 0 && <span className="text-[12px] text-fg2">Browser voice · live audio</span>}
      {prepared.map((voice) => {
        const job = jobs.find((j) => j.docId === it.rec.id && j.voice.id === voice.voiceId && j.voice.engine === voice.engine && (voice.engine !== "openai" || j.openaiModel === openaiModel) && isPreparing(j));
        // Server generation precedes downloading into the browser's audio cache.
        // While a job is active, its confirmed passage count is the live progress.
        const fraction = job && job.total > 0 ? Math.max(0, Math.min(1, job.done / job.total)) : voice.fraction;
        const percent = Math.floor(fraction * 100);
        const stage = job && (job.message ?? (job.status === "queued" ? "Queued" : job.status === "saving" ? "Saving audio on this device" : job.worker ? `Preparing on ${job.worker}` : "Preparing"));
        const progress = job && job.total > 0 ? `${percent}% generated · ${job.done}/${job.total} passages` : `${percent}% prepared`;
        const label = `${voice.name}: ${progress}${stage ? ` · ${stage}` : ""}`;
        // A full ring already says "ready"; only partial audio needs words.
        const detail = job ? (job.total > 0 ? `${percent}% · ${job.done}/${job.total}` : null) : percent === 0 ? "Not prepared" : percent < 100 ? `${percent}%` : null;
        return (
          <button
            key={voice.voiceId}
            type="button"
            onClick={onPrepare}
            title={label}
            className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-pill border bg-bg pl-1.5 pr-2.5 text-left text-[12px] text-fg2 transition-colors duration-fast hover:border-fg3 hover:text-fg", job ? "border-[color-mix(in_oklch,var(--accent)_45%,var(--line))]" : "border-line")}
          >
            <ProgressRing value={fraction} size={18} stroke={2} label={label} />
            <VoiceServiceName source={voiceSource(voice)} className="whitespace-nowrap">{voice.name}</VoiceServiceName>
            {detail && <span className="whitespace-nowrap tabular-nums">{detail}</span>}
            {stage && <span className="min-w-0 truncate text-accent">{stage}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function PrepareDialog({ documents, onClose }: { documents: LibraryItem[]; onClose: () => void }) {
  const voices = useVoices((s) => s.voices);
  const defaultVoice = useSettings((s) => s.voice);
  const available = useMemo(() => voices.filter((v) => v.engine !== LOCAL_ENGINE && !!baseFor(v.engine)), [voices]);
  const [selected, setSelected] = useState<string[]>(() => {
    const used = new Set(documents.flatMap((it) => [it.rec.voice ?? defaultVoice, ...it.prepared.map((v) => v.voiceId)]));
    return available.filter((v) => used.has(v.id)).map((v) => v.id);
  });
  const [query, setQuery] = useState("");
  const chosen = available.filter((v) => selected.includes(v.id));
  const shown = available.filter((v) => `${v.name} ${voiceSource(v)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const paid = chosen.some((v) => isPaidEngine(v.engine));
  const start = () => {
    const count = usePreparation.getState().enqueue(documents.map((it) => it.rec), chosen);
    toast(count ? `Queued ${count} ${count === 1 ? "reading" : "readings"} to prepare` : "These readings are already queued");
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Prepare audio" initialFocus="dialog" className="max-h-[calc(100dvh-48px)]">
      <p className="m-0 text-sm text-fg2">Choose voices for {documents.length === 1 ? `“${documents[0].rec.title}”` : `${documents.length} documents`}. Saved audio is reused. Preparation continues as you browse; keep this tab open.</p>
      <p className="m-0 text-[12px] text-fg2">VoiceStudio prepares one reading at a time on each configured machine and queues the rest. Cloud providers run independently, with up to {PREPARATION_CONCURRENCY} readings each.</p>
      {available.length > 0 ? <>
        <Input leading={<Search size={16} aria-hidden />} aria-label="Search preparation voices" placeholder="Find a voice or provider" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div role="group" aria-label="Preparation voices" className="flex min-h-0 max-h-[42dvh] flex-col gap-1 overflow-y-auto rounded-control border border-line p-2">
          <div className="px-2 text-[12px] text-fg2">Voices · {chosen.length} selected</div>
          {shown.map((voice) => (
            <label key={voice.id} className="flex shrink-0 cursor-pointer items-center gap-3 rounded-control p-2 hover:bg-bg3">
              <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selected.includes(voice.id)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, voice.id] : prev.filter((id) => id !== voice.id))} />
              <VoiceServiceName source={voiceSource(voice)} className="flex-1 text-sm">{voice.name}</VoiceServiceName>
            </label>
          ))}
          {shown.length === 0 && <p className="p-2 text-sm text-fg2">No voices match.</p>}
        </div>
        {paid && <p className="m-0 text-[12px] text-fg2">ChatGPT and Fish voices bill uncached audio for the full document in each selected voice. Jamaican Patois also bills a text rewrite.</p>}
      </> : <p className="m-0 text-sm text-fg2">Connect a speech provider to prepare audio. The browser voice speaks live and cannot be saved.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leading={<Zap size={15} />} disabled={chosen.length === 0 || documents.length === 0} onClick={start}>Prepare {documents.length * chosen.length} {documents.length * chosen.length === 1 ? "reading" : "readings"}</Button>
      </div>
    </Dialog>
  );
}

export function PreparationQueue() {
  const { jobs, cancel, cancelAll, dismissFinished, sharedError, sharing } = usePreparation();
  if (!jobs.length && !sharedError && !sharing) return null;
  const pending = jobs.filter(isPreparing);
  const preparing = pending.filter((job) => job.status === "preparing").length;
  const saving = pending.filter((job) => job.status === "saving").length;
  const queued = pending.filter((job) => job.status === "queued").length;
  const finished = jobs.length - pending.length;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-bg2" role="region" aria-label="Audio preparation queue">
      {sharedError && <p className="m-0 border-b border-line px-4 py-2.5 text-[13px] text-fg2" role="status">Server audio status unavailable: {sharedError}</p>}
      {sharing > 0 && <p className="m-0 border-b border-line px-4 py-2.5 text-[13px] text-fg2" role="status">Sharing saved audio · {sharing} clips remaining. Keep this app open to finish.</p>}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-bg3 text-accent" aria-hidden><Zap size={14} /></span>
        <span className="flex-1 text-sm font-medium" role="status">{pending.length ? `Preparing audio · ${preparing} active${queued ? ` · ${queued} queued` : ""}${saving ? ` · ${saving} saving` : ""}` : "Audio preparation finished"}</span>
        {pending.length > 0 && <Button size="sm" onClick={cancelAll}>Cancel all</Button>}
        {finished > 0 && <Button size="sm" variant="ghost" onClick={dismissFinished}>Clear finished</Button>}
      </div>
      {jobs.length > 0 && (
        <ul className="m-0 max-h-64 list-none divide-y divide-line overflow-y-auto border-t border-line p-0">
          {jobs.map((job) => (
            <li key={job.id} className="flex min-h-12 items-center gap-3 px-4 py-2 text-[12px]">
              <span aria-hidden className="shrink-0"><ProgressRing value={job.status === "ready" ? 1 : job.total > 0 ? job.done / job.total : 0} size={18} stroke={2} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg">{job.title}</div>
                <div className="flex min-w-0 items-center gap-1.5 text-fg2">
                  <VoiceServiceName source={voiceSource(job.voice)} className="shrink-0">{job.voice.name}</VoiceServiceName>
                  <span aria-hidden className="text-fg3">·</span>
                  <span className={cn("truncate", job.status === "error" && "text-danger", job.status === "preparing" && "text-accent")}>
                    {job.status === "preparing" ? job.message ?? `Preparing${job.worker ? ` on ${job.worker}` : ""} · ${job.done}/${job.total} passages` : job.status === "saving" ? "Saving audio on this device…" : job.status === "ready" ? job.message ?? (job.remote ? "Prepared on server" : "Prepared") : job.status === "error" ? job.message : job.status === "cancelled" ? "Cancelled · saved audio kept" : job.message ?? "Queued · waiting for a free machine"}
                  </span>
                </div>
              </div>
              {isPreparing(job) && <Button variant="ghost" size="sm" aria-label={`Cancel ${job.title} in ${job.voice.name}`} onClick={() => cancel(job.id)}>Cancel</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
