import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Voice } from "../data/voices";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { unavailableMessage } from "../engine/engine";
import { isTransientPreparationError } from "../engine/preparation";
import { API_BASE, baseFor, cacheKey, isPaidEngine, prepareInBackground, synthesize } from "../engine/providers";
import { ApiBusy, ApiUnreachable, LOCAL_ENGINE } from "../engine/types";
import { audioCache, docs } from "../lib/db";
import { preparePatois } from "../lib/patois";
import { planPassages, segment } from "../lib/segment";
import { useSettings } from "./settings";

export interface PreparationJob {
  id: string;
  docId: string;
  title: string;
  voice: Voice;
  openaiModel: string;
  wordTimings: boolean;
  status: "queued" | "preparing" | "ready" | "error" | "cancelled";
  done: number;
  total: number;
  message?: string;
}

export const isPreparing = (job: PreparationJob) => job.status === "queued" || job.status === "preparing";
// Each provider gets its own bounded pool so a slow local reading cannot hold
// up cloud voices. VoiceStudio still serializes inference on the server.
export const PREPARATION_CONCURRENCY = 3;
const active = new Map<string, { controller: AbortController; provider: string }>();
const providerFor = (job: PreparationJob) => isPaidEngine(job.voice.engine) ? job.voice.engine : "voicestudio";

interface PreparationState {
  jobs: PreparationJob[];
  enqueue: (documents: { id: string; title: string }[], voices: Voice[]) => number;
  cancel: (id: string) => void;
  cancelDocument: (docId: string) => void;
  cancelAll: () => void;
  dismissFinished: () => void;
}

export const usePreparation = create<PreparationState>()(persist((set, get) => ({
  jobs: [],
  enqueue(documents, voices) {
    const jobs: PreparationJob[] = [];
    const settings = useSettings.getState();
    for (const doc of documents) for (const voice of voices) {
      if (voice.engine === LOCAL_ENGINE || !baseFor(voice.engine)) continue;
      if ([...get().jobs, ...jobs].some((job) => isPreparing(job) && job.docId === doc.id && job.voice.id === voice.id && job.voice.engine === voice.engine && job.openaiModel === settings.openaiModel)) continue;
      jobs.push({ id: crypto.randomUUID(), docId: doc.id, title: doc.title, voice: { ...voice }, openaiModel: settings.openaiModel, wordTimings: settings.wordTimings, status: "queued", done: 0, total: 0 });
    }
    set({ jobs: [...get().jobs.filter((job) => isPreparing(job) || !jobs.some((next) => next.docId === job.docId && next.voice.id === job.voice.id)), ...jobs] });
    drain();
    return jobs.length;
  },
  cancel(id) {
    active.get(id)?.controller.abort();
    set({ jobs: get().jobs.map((job) => job.id === id && isPreparing(job) ? { ...job, status: "cancelled", message: undefined } : job) });
  },
  cancelDocument(docId) {
    for (const job of get().jobs) if (job.docId === docId && isPreparing(job)) get().cancel(job.id);
  },
  cancelAll() {
    for (const job of get().jobs) if (isPreparing(job)) get().cancel(job.id);
  },
  dismissFinished() { set({ jobs: get().jobs.filter(isPreparing) }); },
}), {
  name: "readaloud:preparation-queue",
  partialize: ({ jobs }) => ({ jobs }),
  merge: (persisted, current) => {
    const { jobs = [] } = (persisted ?? {}) as { jobs?: PreparationJob[] };
    return { ...current, jobs: jobs.map((job) => job.status === "preparing" ? { ...job, status: "queued", message: undefined } : job) };
  },
  // Local storage hydrates synchronously, before usePreparation is initialized.
  // Re-enter the worker afterwards; server jobs reconnect and saved audio is reused.
  onRehydrateStorage: () => (_state, error) => { if (!error) queueMicrotask(() => { void drain(); }); },
}));

const update = (id: string, patch: Partial<PreparationJob>) => usePreparation.setState((state) => ({ jobs: state.jobs.map((job) => job.id === id ? { ...job, ...patch } : job) }));

/** Rotate whole-reading jobs through bounded provider pools. Each server job
 * yields between passages, sharing the single VoiceStudio worker fairly. */
function drain() {
  const counts = new Map<string, number>();
  for (const { provider } of active.values()) counts.set(provider, (counts.get(provider) || 0) + 1);
  for (const job of usePreparation.getState().jobs) {
    const provider = providerFor(job);
    if (job.status !== "queued" || (counts.get(provider) || 0) >= PREPARATION_CONCURRENCY) continue;
    const controller = new AbortController();
    active.set(job.id, { controller, provider });
    counts.set(provider, (counts.get(provider) || 0) + 1);
    update(job.id, { status: "preparing" });
    void run(job, controller.signal).finally(() => {
      active.delete(job.id);
      drain();
    });
  }
}

async function run(job: PreparationJob, signal: AbortSignal) {
  try {
    let rec = await docs.get(job.docId);
    if (!rec) throw new Error("This document is no longer in the Library.");
    signal.throwIfAborted();
    if (job.voice.id === JAMAICAN_PATOIS_VOICE_ID) {
      const prepared = await preparePatois(rec, signal, (message) => update(job.id, { message }));
      signal.throwIfAborted();
      const latest = await docs.get(job.docId);
      if (!latest || latest.text !== rec.text) throw new Error("The document changed. Prepare it again.");
      signal.throwIfAborted();
      rec = { ...latest, patois: prepared.patois };
      await docs.put(rec);
    }
    const { sentences } = segment(job.voice.id === JAMAICAN_PATOIS_VOICE_ID ? rec.patois!.text : rec.text);
    const passages = planPassages(sentences);
    if (!passages.length) throw new Error("There is no text to prepare.");
    update(job.id, { total: passages.length, message: undefined });
    if (API_BASE === "/api/vs" && !isPaidEngine(job.voice.engine)) {
      await prepareInBackground(passages.map((passage) => ({
        text: passage.text, voice: job.voice.id, engine: job.voice.engine, profile: job.voice.kind === "profile",
      })), 0, (done) => update(job.id, { done }), signal);
    }
    for (const passage of passages) {
      signal.throwIfAborted();
      const req = {
        text: passage.text, voice: job.voice.id, engine: job.voice.engine, openaiModel: job.openaiModel,
        profile: job.voice.kind === "profile", wordTimings: job.wordTimings,
        words: passage.parts.flat(), parts: passage.parts,
        sentences: sentences.slice(passage.start, passage.end).map((s) => s.text),
        fallbackLocal: false, signal,
      };
      const chunk = await synthesize(req);
      signal.throwIfAborted();
      if (!chunk.audio) throw new Error("This voice did not return audio to prepare.");
      // Older sentence clips can be joined in memory; those are already safely cached.
      if (chunk.source !== "cache" && !(await audioCache.get(cacheKey(req)))) throw new Error("Could not save prepared audio. Free some storage and retry.");
      update(job.id, { done: Math.max(usePreparation.getState().jobs.find((j) => j.id === job.id)?.done || 0, passage.index + 1) });
    }
    signal.throwIfAborted();
    update(job.id, { status: "ready" });
  } catch (error) {
    if (!signal.aborted && (isTransientPreparationError(error) || error instanceof ApiUnreachable || error instanceof ApiBusy)) {
      update(job.id, { message: "Waiting for the speech server to reconnect…" });
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, 1500);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
      update(job.id, { status: signal.aborted ? "cancelled" : "queued", message: undefined });
    } else {
      update(job.id, signal.aborted ? { status: "cancelled", message: undefined } : { status: "error", message: unavailableMessage(error) });
    }
  }
}
