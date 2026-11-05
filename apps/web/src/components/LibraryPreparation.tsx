import { useMemo, useState } from "react";
import { Button, Dialog, Input, ProgressRing, VoiceSourceBadge } from "@readaloud/ui";
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1.5" role="group" aria-label="Prepared audio">
      {prepared.length > 0 && <span className="text-[11px] text-fg2">Prepared</span>}
      {prepared.length === 0 && <span className="text-[12px] text-fg2">Browser voice · live audio</span>}
      {prepared.map((voice) => {
        const job = jobs.find((j) => j.docId === it.rec.id && j.voice.id === voice.voiceId && isPreparing(j));
        const percent = Math.floor(voice.fraction * 100);
        return (
          <button key={voice.voiceId} type="button" onClick={onPrepare} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[12px] text-fg2 hover:text-fg" title={`${voice.name}: ${percent}% prepared${job ? ` · ${job.status}` : ""}`}>
            <ProgressRing value={voice.fraction} size={24} stroke={2} label={`${voice.name}: ${percent}% prepared`} />
            <span>{voice.name} <span className="tabular-nums">· {percent}%</span>{job && <span className="text-accent"> · {job.status === "queued" ? "Queued" : "Preparing"}</span>}</span>
            <VoiceSourceBadge source={voiceSource(voice)} />
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
      <p className="m-0 text-[12px] text-fg2">Up to {PREPARATION_CONCURRENCY} readings per provider prepare together. VoiceStudio shares its worker between readings; cloud providers run independently.</p>
      {available.length > 0 ? <>
        <Input leading={<Search size={16} aria-hidden />} aria-label="Search preparation voices" placeholder="Find a voice or provider" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div role="group" aria-label="Preparation voices" className="flex min-h-0 max-h-[42dvh] flex-col gap-1 overflow-y-auto rounded-control border border-line p-2">
          <div className="px-2 text-[12px] text-fg2">Voices · {chosen.length} selected</div>
          {shown.map((voice) => (
            <label key={voice.id} className="flex shrink-0 cursor-pointer items-center gap-3 rounded-control p-2 hover:bg-bg3">
              <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selected.includes(voice.id)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, voice.id] : prev.filter((id) => id !== voice.id))} />
              <span className="flex-1 text-sm">{voice.name}</span>
              <VoiceSourceBadge source={voiceSource(voice)} />
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
  const { jobs, cancel, cancelAll, dismissFinished } = usePreparation();
  if (!jobs.length) return null;
  const pending = jobs.filter(isPreparing);
  const preparing = pending.filter((job) => job.status === "preparing").length;
  const queued = pending.length - preparing;
  const finished = jobs.length - pending.length;
  return (
    <div className="rounded-card border border-line bg-bg2 p-4" role="region" aria-label="Audio preparation queue">
      <div className="flex flex-wrap items-center gap-3">
        <Zap size={16} className="text-accent" aria-hidden />
        <span className="flex-1 text-sm" role="status">{pending.length ? `Preparing audio · ${preparing} active${queued ? ` · ${queued} queued` : ""}` : "Audio preparation finished"}</span>
        {pending.length > 0 && <Button size="sm" onClick={cancelAll}>Cancel all</Button>}
        {finished > 0 && <Button size="sm" variant="ghost" onClick={dismissFinished}>Clear finished</Button>}
      </div>
      <ul className="mb-0 mt-3 flex max-h-64 list-none flex-col gap-3 overflow-y-auto p-0">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-3 text-[12px]">
            <div className="min-w-0 flex-1">
              <div className="truncate text-fg">{job.title} · {job.voice.name}</div>
              <div className={job.status === "error" ? "text-danger" : "text-fg2"}>
                {job.status === "preparing" ? job.message ?? `Preparing ${job.done}/${job.total} passages` : job.status === "ready" ? "Prepared" : job.status === "error" ? job.message : job.status === "cancelled" ? "Cancelled · saved audio kept" : "Queued"}
              </div>
            </div>
            <VoiceSourceBadge source={voiceSource(job.voice)} />
            {isPreparing(job) && <Button variant="ghost" size="sm" aria-label={`Cancel ${job.title} in ${job.voice.name}`} onClick={() => cancel(job.id)}>Cancel</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
