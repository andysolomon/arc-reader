import { create } from "zustand";
import type { Voice } from "../data/voices";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { unavailableMessage } from "../engine/engine";
import { API_BASE, baseFor, cacheKey, isPaidEngine, prepareInBackground, synthesize } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
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
let running = false;
let active: { id: string; controller: AbortController } | null = null;

interface PreparationState {
  jobs: PreparationJob[];
  enqueue: (documents: { id: string; title: string }[], voices: Voice[]) => number;
  cancel: (id: string) => void;
  cancelDocument: (docId: string) => void;
  cancelAll: () => void;
  dismissFinished: () => void;
}

export const usePreparation = create<PreparationState>()((set, get) => ({
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
    void drain();
    return jobs.length;
  },
  cancel(id) {
    if (active?.id === id) active.controller.abort();
    set({ jobs: get().jobs.map((job) => job.id === id && isPreparing(job) ? { ...job, status: "cancelled", message: undefined } : job) });
  },
  cancelDocument(docId) {
    for (const job of get().jobs) if (job.docId === docId && isPreparing(job)) get().cancel(job.id);
  },
  cancelAll() {
    for (const job of get().jobs) if (isPreparing(job)) get().cancel(job.id);
  },
  dismissFinished() { set({ jobs: get().jobs.filter(isPreparing) }); },
}));

const update = (id: string, patch: Partial<PreparationJob>) => usePreparation.setState((state) => ({ jobs: state.jobs.map((job) => job.id === id ? { ...job, ...patch } : job) }));

/** One batch can contain many documents and voices. Keep the single-worker server's queue bounded. */
async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = usePreparation.getState().jobs.find((job) => job.status === "queued");
      if (!job) break;
      const controller = new AbortController();
      const { signal } = controller;
      active = { id: job.id, controller };
      update(job.id, { status: "preparing" });
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
        update(job.id, signal.aborted ? { status: "cancelled", message: undefined } : { status: "error", message: unavailableMessage(error) });
      } finally {
        active = null;
      }
    }
  } finally {
    running = false;
  }
}
