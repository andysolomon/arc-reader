import { useMemo, useState } from "react";
import { Button, Dialog, Input, ProgressRing, VoiceServiceName, cn } from "@readaloud/ui";
import { ChevronsUp, Search, Volume2, Zap } from "lucide-react";
import { JAMAICAN_PATOIS_VOICE_ID, voiceSource } from "../data/voices";
import { FISH_ENGINE, FISH_MODEL, baseFor, isPaidEngine, openaiModelFor, preparesOnServer } from "../engine/providers";
import { readingCost } from "../lib/premiumEstimate";
import { formatUsd } from "../lib/usage";
import { usePremiumContext } from "../state/premium";
import { LOCAL_ENGINE } from "../engine/types";
import { isPreparing, PREPARATION_CONCURRENCY, providerFor, usePreparation, type PreparationJob } from "../state/preparation";
import { getVoice, isLocalVoice, useVoices } from "../state/voices";
import { useSettings } from "../state/settings";
import { toast } from "../state/toast";
import type { LibraryItem } from "../state/library";
import { catalogue } from "../lib/postTitle";
import { dateLabel } from "../lib/dates";

/** One document read in one voice. */
export interface Reading { docId: string; voiceId: string; engine: string }
const sameReading = (job: PreparationJob, reading: Reading, openaiModel: string) => job.docId === reading.docId && job.voice.id === reading.voiceId
  && job.voice.engine === reading.engine && (reading.engine !== "openai" || job.remote || job.openaiModel === openaiModel);

export function PreparedStatus({ it, defaultVoice, onDetails }: { it: LibraryItem; defaultVoice: string; onDetails: (reading: Reading) => void }) {
  const jobs = usePreparation((s) => s.jobs);
  const openaiModel = useSettings((s) => s.openaiModel);
  useVoices((s) => s.voices);
  const voiceId = it.rec.voice ?? defaultVoice;
  const prepared = [...it.prepared];
  for (const job of jobs) {
    if (job.docId === it.rec.id && isPreparing(job) && !prepared.some((v) => v.voiceId === job.voice.id)) prepared.push({ voiceId: job.voice.id, name: job.voice.name, engine: job.voice.engine, fraction: 0 });
  }
  // The voice this document is read in leads, whether or not it has audio saved.
  const reading = prepared.find((v) => v.voiceId === voiceId);
  const live = !reading && isLocalVoice(voiceId);
  if (!reading && !live) {
    const voice = getVoice(voiceId);
    prepared.unshift({ voiceId, name: voice.name, engine: voice.engine, fraction: 0 });
  } else if (reading) {
    prepared.unshift(...prepared.splice(prepared.indexOf(reading), 1));
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Prepared audio">
      {live && (
        <span className="mr-1 inline-flex h-7 items-center gap-1.5 whitespace-nowrap text-[12px] text-fg2" title="Reading voice">
          <Volume2 size={13} strokeWidth={1.5} className="shrink-0 text-fg3" aria-hidden />
          <span className="sr-only">Reading voice</span>
          <span><VoiceServiceName source={voiceSource(getVoice(voiceId))}>{getVoice(voiceId).name}</VoiceServiceName> · live audio</span>
        </span>
      )}
      {prepared.map((voice) => {
        const job = jobs.find((j) => j.docId === it.rec.id && j.voice.id === voice.voiceId && j.voice.engine === voice.engine && (voice.engine !== "openai" || j.openaiModel === openaiModel) && isPreparing(j));
        // Server generation precedes downloading into the browser's audio cache.
        // While a job is active, its confirmed passage count is the live progress.
        const fraction = job && job.total > 0 ? Math.max(0, Math.min(1, job.done / job.total)) : voice.fraction;
        const percent = Math.floor(fraction * 100);
        const stage = job && (job.message ?? (job.status === "queued" ? (job.waitingFor ? `Waiting for ${job.waitingFor}` : "Queued") : job.status === "saving" ? "Saving audio on this device" : job.worker ? `Preparing on ${job.worker}` : "Preparing"));
        const progress = job && job.total > 0 ? `${percent}% generated · ${job.done}/${job.total} passages` : `${percent}% prepared`;
        const isReading = voice.voiceId === voiceId;
        const label = `${voice.name}: ${progress}${stage ? ` · ${stage}` : ""}`;
        // The ring and outline carry the two ends: full is ready, empty and dashed is not prepared. Only partial audio needs words.
        const empty = !job && percent === 0;
        const detail = job ? (job.total > 0 ? `${percent}% · ${job.done}/${job.total}` : null) : percent > 0 && percent < 100 ? `${percent}%` : null;
        return (
          <button
            key={voice.voiceId}
            type="button"
            onClick={() => onDetails({ docId: it.rec.id, voiceId: voice.voiceId, engine: voice.engine })}
            aria-haspopup="dialog"
            title={`${isReading ? "Reading voice · " : ""}${empty ? `${voice.name}: not prepared` : label}`}
            data-reading-voice={isReading || undefined}
            className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-pill border bg-bg pl-1.5 pr-2.5 text-left text-[12px] text-fg2 transition-colors duration-fast hover:border-fg3 hover:text-fg", job ? "border-[color-mix(in_oklch,var(--accent)_45%,var(--line))]" : "border-line", empty && "border-dashed bg-transparent")}
          >
            <ProgressRing value={fraction} size={18} stroke={2} label={label} />
            {isReading && <><Volume2 size={13} strokeWidth={1.5} className="-mr-0.5 shrink-0" aria-hidden /><span className="sr-only">Reading voice</span></>}
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
  const premium = usePremiumContext();
  const openaiModel = useSettings((s) => s.openaiModel);
  // What the paid voices would bill for audio not saved yet, before any is made.
  const paidCosts = useMemo(() => chosen.filter((v) => isPaidEngine(v.engine)).flatMap((voice) => {
    const provider = voice.engine === FISH_ENGINE ? "fish" as const : "openai" as const;
    const model = provider === "fish" ? FISH_MODEL : openaiModelFor({ voice: voice.id, openaiModel });
    let total = 0;
    for (const it of documents) {
      const rec = voice.id === JAMAICAN_PATOIS_VOICE_ID && it.rec.patois ? { ...it.rec, text: it.rec.patois.text } : it.rec;
      const cost = readingCost(rec, provider, model, premium.calibration, { explainable: premium.explainable });
      if (cost === null) return [];
      total += cost * (1 - (it.prepared.find((p) => p.voiceId === voice.id)?.fraction ?? 0));
    }
    return [{ name: voice.name, cost: total }];
  }), [chosen, documents, openaiModel, premium]);
  const start = () => {
    const count = usePreparation.getState().enqueue(documents.map((it) => it.rec), chosen);
    toast(count ? `Queued ${count} ${count === 1 ? "reading" : "readings"} to prepare` : "These readings are already queued");
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Prepare audio" initialFocus="dialog" className="max-h-[calc(100dvh-48px)]">
      <p className="m-0 text-sm text-fg2">Choose voices for {documents.length === 1 ? `“${catalogue(documents[0].rec).title}”` : `${documents.length} documents`}. Saved audio is reused. Preparation continues as you browse; keep this tab open.</p>
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
        {paidCosts.length > 0 && (
          <p className="m-0 text-[13px] text-fg" aria-label="Estimated cost">
            Estimated cost ≈{formatUsd(paidCosts.reduce((n, c) => n + c.cost, 0))}
            {paidCosts.length > 1 && <span className="text-fg2"> · {paidCosts.map((c) => `${c.name} ≈${formatUsd(c.cost)}`).join(" · ")}</span>}
            <span className="text-fg2"> · audio already saved is not billed again</span>
          </p>
        )}
      </> : <p className="m-0 text-sm text-fg2">Connect a speech provider to prepare audio. The browser voice speaks live and cannot be saved.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leading={<Zap size={15} />} disabled={chosen.length === 0 || documents.length === 0} onClick={start}>Prepare {documents.length * chosen.length} {documents.length * chosen.length === 1 ? "reading" : "readings"}</Button>
      </div>
    </Dialog>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What one voice has prepared for one document, and the controls to move it through the queue. */
export function PreparationDetails({ it, reading, defaultVoice, onClose, onChooseVoices }: { it: LibraryItem; reading: Reading; defaultVoice: string; onClose: () => void; onChooseVoices: () => void }) {
  const jobs = usePreparation((s) => s.jobs);
  const openaiModel = useSettings((s) => s.openaiModel);
  const voices = useVoices((s) => s.voices);
  const [moving, setMoving] = useState<"next" | "now" | null>(null);
  const mine = jobs.filter((job) => sameReading(job, reading, openaiModel));
  const job = mine.find(isPreparing);
  const last = job ? undefined : mine[mine.length - 1];
  const saved = it.prepared.find((v) => v.voiceId === reading.voiceId && v.engine === reading.engine);
  const known = voices.find((v) => v.id === reading.voiceId && v.engine === reading.engine);
  const voice = job?.voice ?? known ?? saved ?? last?.voice ?? getVoice(reading.voiceId);
  const savedPercent = Math.floor((saved?.fraction ?? 0) * 100);
  const title = catalogue(it.rec).title;
  const server = !!job && (!!job.serverId || preparesOnServer(job.voice.engine));
  // Readings this device has not handed over yet wait in its own queue, in order.
  const localAhead = job && !job.serverId ? jobs.slice(0, jobs.indexOf(job)).filter((other) => other.status === "queued" && !other.serverId && providerFor(other) === providerFor(job)).length : 0;
  const ahead = job?.status !== "queued" ? undefined : job.serverId ? job.ahead : localAhead;
  const machine = job?.worker ?? job?.waitingFor;
  const fraction = job ? (job.total > 0 ? job.done / job.total : 0) : saved?.fraction ?? (last?.status === "ready" ? 1 : 0);

  const status = job
    ? job.message ?? (job.status === "queued" ? `Queued · waiting for ${job.waitingFor ?? (server ? "a free machine" : "its turn")}`
      : job.status === "saving" ? "Saving audio on this device" : `Preparing${job.worker ? ` on ${job.worker}` : ""}`)
    : last?.status === "error" ? last.message || "Preparation failed"
    : savedPercent >= 100 ? "Prepared"
    : last?.status === "cancelled" ? "Cancelled · saved audio kept"
    : last?.status === "ready" ? last.message ?? (last.remote ? "Prepared on the server" : "Prepared")
    : savedPercent > 0 ? "Partly prepared" : "Not prepared";
  const queue = ahead === undefined ? null
    : `${ahead === 0 ? (job?.busy ? "Next, after the reading in progress" : "Next in line") : `${plural(ahead, "reading")} ahead`}${job?.prioritized ? " · moved to the front" : ""}`;
  const counted = job ?? (last && last.total > 0 ? last : undefined);
  const queuedAt = (job ?? last)?.createdAt;

  const move = async (now: boolean) => {
    if (!job) return;
    setMoving(now ? "now" : "next");
    try { await usePreparation.getState().prioritize(job.id, now); }
    catch (error) { toast(`Could not move this reading up. ${(error as Error).message}`); }
    finally { setMoving(null); }
  };
  const canPrepare = !job && savedPercent < 100 && !!known && known.engine !== LOCAL_ENGINE && !!baseFor(known.engine);
  const prepare = () => {
    // Paid voices show their cost before anything is made.
    if (isPaidEngine(known!.engine)) return onChooseVoices();
    usePreparation.getState().enqueue([it.rec], [known!]);
  };
  const row = "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 py-2";
  return (
    <Dialog open onClose={onClose} title="Audio preparation" initialFocus="dialog" className="max-h-[calc(100dvh-48px)] overflow-y-auto">
      <div className="flex items-center gap-3">
        <ProgressRing value={fraction} size={36} label={`${voice.name}: ${Math.floor(fraction * 100)}%`} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] text-fg"><VoiceServiceName source={voiceSource(voice)}>{voice.name}</VoiceServiceName></div>
          <div className="truncate text-[13px] text-fg2">{title}</div>
        </div>
      </div>
      <dl className="m-0 divide-y divide-line border-y border-line text-[13px]">
        <div className={row}>
          <dt className="text-fg2">Status</dt>
          <dd className={cn("m-0", last?.status === "error" && !job ? "text-danger" : job ? "text-accent" : "text-fg")}>{status}</dd>
        </div>
        {queue && <div className={row}><dt className="text-fg2">Queue</dt><dd className="m-0 text-fg">{queue}</dd></div>}
        {machine && <div className={row}><dt className="text-fg2">Machine</dt><dd className="m-0 text-fg">{machine}</dd></div>}
        {counted && counted.total > 0 && <div className={row}><dt className="text-fg2">Generated</dt><dd className="m-0 tabular-nums text-fg">{counted.done} of {plural(counted.total, "passage")}</dd></div>}
        <div className={row}><dt className="text-fg2">On this device</dt><dd className="m-0 tabular-nums text-fg">{savedPercent}% saved</dd></div>
        <div className={row}><dt className="text-fg2">Role</dt><dd className="m-0 text-fg">{(it.rec.voice ?? defaultVoice) === reading.voiceId ? "Reading voice" : "Extra prepared voice"}</dd></div>
        {queuedAt ? <div className={row}><dt className="text-fg2">Queued</dt><dd className="m-0 text-fg">{dateLabel(queuedAt)} at {new Date(queuedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</dd></div> : null}
      </dl>
      {(job || canPrepare) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {job?.status === "queued" && <Button leading={<ChevronsUp size={15} />} disabled={ahead === 0 || !!moving} loading={moving === "next"} onClick={() => void move(false)}>Prepare next</Button>}
            {job?.status === "queued" && job.serverId && <Button leading={<Zap size={15} />} disabled={!job.busy || !!moving} loading={moving === "now"} onClick={() => void move(true)}>Start now</Button>}
            {job && <Button variant="danger" onClick={() => usePreparation.getState().cancel(job.id)}>Cancel preparation</Button>}
            {canPrepare && <Button variant="primary" leading={<Zap size={15} />} onClick={prepare}>{last?.status === "error" ? "Try again" : savedPercent > 0 ? "Finish preparing" : "Prepare audio"}</Button>}
          </div>
          {job?.status === "queued" && (
            <p className="m-0 text-[12px] text-fg2">
              {job.serverId
                ? job.busy ? `Prepare next moves this ahead of the other waiting readings. Start now also pauses the reading ${machine ?? "its machine"} is preparing after its current passage; that one resumes afterwards.`
                  : "Nothing is being prepared on its machine, so this starts as soon as the machine answers."
                : "Prepare next moves this ahead of the other readings waiting on this device."}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" className="-ml-3" onClick={onChooseVoices}>More voices…</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

export function PreparationQueue({ onDetails }: { onDetails?: (reading: Reading) => void }) {
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
              <button type="button" disabled={!onDetails} title="Preparation details" aria-haspopup="dialog" onClick={() => onDetails?.({ docId: job.docId, voiceId: job.voice.id, engine: job.voice.engine })} className="block min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-[12px] disabled:cursor-default">
                <div className="truncate text-[13px] text-fg">{job.title}</div>
                <div className="flex min-w-0 items-center gap-1.5 text-fg2">
                  <VoiceServiceName source={voiceSource(job.voice)} className="shrink-0">{job.voice.name}</VoiceServiceName>
                  <span aria-hidden className="text-fg3">·</span>
                  <span className={cn("truncate", job.status === "error" && "text-danger", job.status === "preparing" && "text-accent")}>
                    {job.status === "preparing" ? job.message ?? `Preparing${job.worker ? ` on ${job.worker}` : ""} · ${job.done}/${job.total} passages` : job.status === "saving" ? "Saving audio on this device…" : job.status === "ready" ? job.message ?? (job.remote ? "Prepared on server" : "Prepared") : job.status === "error" ? job.message : job.status === "cancelled" ? "Cancelled · saved audio kept" : job.message ?? `Queued · waiting for ${job.waitingFor ?? "a free machine"}`}
                  </span>
                </div>
              </button>
              {isPreparing(job) && <Button variant="ghost" size="sm" aria-label={`Cancel ${job.title} in ${job.voice.name}`} onClick={() => cancel(job.id)}>Cancel</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
