import { prepareVisualDescriptions } from "../lib/visualDescriptions";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Voice } from "../data/voices";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { unavailableMessage } from "../engine/engine";
import { isTransientPreparationError, prioritizePreparation, refreshPreparationCatalog, sharedAudioRemaining } from "../engine/preparation";
import { baseFor, cacheKey, hasOwnServer, hasPreparationServer, prepareInBackground, preparesOnServer, synthesize } from "../engine/providers";
import { ApiBusy, ApiUnreachable, LOCAL_ENGINE } from "../engine/types";
import { audioCache, docs } from "../lib/db";
import { prepareCodeSummaries } from "../lib/codeSummaries";
import { preparePatois } from "../lib/patois";
import { planPassages, segment } from "../lib/segment";
import { useSettings } from "./settings";
import { getVoice } from "./voices";
import { sharedPreparationJobs } from "../lib/sharedPreparations";

export interface PreparationJob {
  id: string;
  docId: string;
  title: string;
  voice: Voice;
  openaiModel: string;
  wordTimings: boolean;
  status: "queued" | "preparing" | "saving" | "ready" | "error" | "cancelled";
  done: number;
  total: number;
  message?: string;
  worker?: string;
  /** Set when a queued reading can only run on one machine. */
  waitingFor?: string;
  serverId?: string;
  remote?: boolean;
  /** When it joined the queue. */
  createdAt?: number;
  /** Waiting readings the server will prepare before this one. */
  ahead?: number;
  /** Moved to the front of the queue. */
  prioritized?: boolean;
  /** Its machine is preparing another reading. */
  busy?: boolean;
}

export const isPreparing = (job: PreparationJob) => ["queued", "preparing", "saving"].includes(job.status);
// Cloud providers keep bounded parallelism. VoiceStudio and Phonon submissions join
// the durable server queue, which reserves exactly one whole reading per machine.
export const PREPARATION_CONCURRENCY = 3;
export const PREPARATION_QUEUE_LIMIT = 20;
const active = new Map<string, { controller: AbortController; provider: string }>();
/** Local readings moved up before the server knew of them; it is told once they are submitted. */
const raised = new Map<string, { now: boolean; sent?: boolean }>();
const SENDING = "Sending to the server…";
export const providerFor = (job: PreparationJob) => hasOwnServer(job.voice.engine) ? job.voice.engine : "voicestudio";

interface PreparationState {
  jobs: PreparationJob[];
  enqueue: (documents: { id: string; title: string }[], voices: Voice[]) => number;
  /** Prepare a waiting reading before the others. `now` also pauses the reading its machine is on. */
  prioritize: (id: string, now?: boolean) => Promise<void>;
  cancel: (id: string) => void;
  cancelDocument: (docId: string) => void;
  cancelAll: () => void;
  dismissFinished: () => void;
  /** Finished server readings cleared from the queue; persisted so sync doesn't bring them back. */
  hiddenShared: string[];
  sharedError: string | null;
  sharing: number;
  refreshShared: () => Promise<void>;
}

let sharedRefresh: Promise<void> | null = null;
const sameReading = (a: PreparationJob, b: PreparationJob) => a.docId === b.docId && a.voice.id === b.voice.id && a.voice.engine === b.voice.engine;

export const usePreparation = create<PreparationState>()(persist((set, get) => ({
  jobs: [],
  hiddenShared: [],
  sharedError: null,
  sharing: 0,
  async refreshShared() {
    if (!hasPreparationServer()) return;
    if (sharedRefresh) return sharedRefresh;
    sharedRefresh = (async () => {
      try {
        const catalogue = await refreshPreparationCatalog();
        const remote = sharedPreparationJobs(await docs.all(), catalogue, getVoice);
        const hidden = new Set(get().hiddenShared);
        let jobs = get().jobs.filter((job) => !job.remote);
        for (const job of remote) {
          if (hidden.has(job.id) && !isPreparing(job)) continue;
          const local = jobs.find((other) => sameReading(job, other));
          if (local && (isPreparing(local) || (local.serverId === job.serverId && local.status === job.status))) continue;
          jobs = jobs.filter((other) => !sameReading(job, other));
          jobs.push(job);
        }
        // Forget dismissals for readings the server no longer lists.
        const hiddenShared = remote.filter((job) => hidden.has(job.id)).map((job) => job.id);
        set({ jobs, hiddenShared, sharedError: null, sharing: sharedAudioRemaining() });
      } catch (error) {
        set({ sharedError: (error as Error).message });
      }
    })().finally(() => { sharedRefresh = null; });
    return sharedRefresh;
  },
  enqueue(documents, voices) {
    const jobs: PreparationJob[] = [];
    const settings = useSettings.getState();
    for (const doc of documents) for (const voice of voices) {
      if (voice.engine === LOCAL_ENGINE || !baseFor(voice.engine)) continue;
      if ([...get().jobs, ...jobs].some((job) => isPreparing(job) && job.docId === doc.id && job.voice.id === voice.id && job.voice.engine === voice.engine && job.openaiModel === settings.openaiModel)) continue;
      jobs.push({ id: crypto.randomUUID(), docId: doc.id, title: doc.title, voice: { ...voice }, openaiModel: settings.openaiModel, wordTimings: settings.wordTimings, status: "queued", done: 0, total: 0, createdAt: Date.now() });
    }
    set({ jobs: [...get().jobs.filter((job) => isPreparing(job) || !jobs.some((next) => next.docId === job.docId && next.voice.id === job.voice.id)), ...jobs] });
    drain();
    return jobs.length;
  },
  async prioritize(id, now = false) {
    const job = get().jobs.find((job) => job.id === id);
    if (!job || job.status !== "queued") return;
    if (job.serverId) {
      const status = await prioritizePreparation(job.serverId, now);
      update(id, { ahead: status.ahead, prioritized: status.prioritized, busy: status.busy });
      if (job.remote) void get().refreshShared();
      return;
    }
    // Not on the server yet: this queue's order decides what is started or submitted next.
    raised.set(id, { now });
    set({ jobs: [{ ...job, prioritized: true }, ...get().jobs.filter((other) => other.id !== id)] });
    drain();
  },
  cancel(id) {
    const job = get().jobs.find((job) => job.id === id);
    if (job?.remote && job.serverId) {
      void fetch(`/api/preparations/${job.serverId}`, { method: "DELETE" }).then((response) => {
        if (!response.ok) throw new Error("Could not cancel server audio preparation.");
        return get().refreshShared();
      }).catch((error) => set({ sharedError: (error as Error).message }));
      return;
    }
    active.get(id)?.controller.abort();
    set({ jobs: get().jobs.map((job) => job.id === id && isPreparing(job) ? { ...job, status: "cancelled", message: undefined } : job) });
  },
  cancelDocument(docId) {
    for (const job of get().jobs) if (job.docId === docId && isPreparing(job)) get().cancel(job.id);
  },
  cancelAll() {
    for (const job of get().jobs) if (isPreparing(job)) get().cancel(job.id);
  },
  dismissFinished() {
    const cleared = get().jobs.filter((job) => job.remote && !isPreparing(job)).map((job) => job.id);
    set({ jobs: get().jobs.filter(isPreparing), hiddenShared: [...new Set([...get().hiddenShared, ...cleared])] });
  },
}), {
  name: "readaloud:preparation-queue",
  partialize: ({ jobs, hiddenShared }) => ({ jobs: jobs.filter((job) => !job.remote), hiddenShared }),
  merge: (persisted, current) => {
    const { jobs = [], hiddenShared = [] } = (persisted ?? {}) as { jobs?: PreparationJob[]; hiddenShared?: string[] };
    return { ...current, hiddenShared, jobs: jobs.map((job) => ["preparing", "saving"].includes(job.status) ? { ...job, status: "queued", message: undefined, worker: undefined, waitingFor: undefined, ahead: undefined, busy: undefined } : job) };
  },
  // Local storage hydrates synchronously, before usePreparation is initialized.
  // Re-enter the worker afterwards; server jobs reconnect and saved audio is reused.
  onRehydrateStorage: () => (_state, error) => { if (!error) queueMicrotask(() => { void drain(); }); },
}));

const update = (id: string, patch: Partial<PreparationJob>) => usePreparation.setState((state) => ({ jobs: state.jobs.map((job) => job.id === id ? { ...job, ...patch } : job) }));

/** Submit local work to the server's machine scheduler. Cloud voices use their
 * own pools and never occupy a machine's reservation; Phonon readings queue for the Phonon server. */
function drain() {
  const counts = new Map<string, number>();
  for (const { provider } of active.values()) counts.set(provider, (counts.get(provider) || 0) + 1);
  for (const job of usePreparation.getState().jobs) {
    if (job.remote) continue;
    const provider = providerFor(job);
    const background = preparesOnServer(job.voice.engine);
    const limit = background ? PREPARATION_QUEUE_LIMIT : provider === "voicestudio" ? 1 : PREPARATION_CONCURRENCY;
    if (job.status !== "queued" || active.has(job.id) || (counts.get(provider) || 0) >= limit) continue;
    const controller = new AbortController();
    active.set(job.id, { controller, provider });
    counts.set(provider, (counts.get(provider) || 0) + 1);
    // A server reading is not waiting for a machine until the server has it.
    update(job.id, { status: background ? "queued" : "preparing", worker: undefined, waitingFor: undefined, message: background ? SENDING : undefined });
    void run(job, controller.signal).finally(() => {
      active.delete(job.id);
      raised.delete(job.id);
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
    const text = job.voice.id === JAMAICAN_PATOIS_VOICE_ID ? rec.patois!.text : rec.text;
    let explained = await prepareCodeSummaries(rec, text, useSettings.getState().summaryModel, signal, (message) => update(job.id, { message }));
    signal.throwIfAborted();
    // Prepared audio keeps its wording, so every slide of a deck is described first.
    explained = await prepareVisualDescriptions(explained, text, signal, (message) => update(job.id, { message }), { all: true });
    signal.throwIfAborted();
    if (explained !== rec) {
      const latest = await docs.get(job.docId);
      signal.throwIfAborted();
      if (!latest || latest.text !== rec.text) throw new Error("The document changed. Prepare it again.");
      rec = { ...latest, codeSummaries: { ...latest.codeSummaries, ...explained.codeSummaries }, visualDescriptions: { ...latest.visualDescriptions, ...explained.visualDescriptions } };
      await docs.put(rec);
    }
    const { sentences } = segment(text, rec.codeSummaries, rec.visualDescriptions);
    const passages = planPassages(sentences);
    if (!passages.length) throw new Error("There is no text to prepare.");
    const onServer = preparesOnServer(job.voice.engine);
    update(job.id, { total: passages.length, message: onServer ? SENDING : undefined });
    if (onServer) {
      await prepareInBackground(passages.map((passage) => ({
        text: passage.text, voice: job.voice.id, engine: job.voice.engine, profile: job.voice.kind === "profile",
      })), 0, (done, total, status) => {
        if (signal.aborted) return;
        const move = raised.get(job.id);
        if (move && !move.sent && status?.id) {
          move.sent = true;
          void prioritizePreparation(status.id, move.now).catch(() => {}).finally(() => raised.delete(job.id));
        }
        update(job.id, {
          done, total, status: status?.queued || status?.submitting ? "queued" : "preparing", worker: status?.worker, waitingFor: status?.waitingFor,
          ...(status?.id ? { serverId: status.id } : {}), message: status?.unreachable ? "Can't reach the server. Retrying…" : status?.submitting ? SENDING : undefined,
          // A lost connection says nothing about the queue; keep the last answer.
          ...(status?.unreachable ? {} : { ahead: status?.ahead, busy: status?.busy, prioritized: status?.prioritized || (status?.queued && raised.has(job.id)) || undefined }),
        });
      }, signal);
      signal.throwIfAborted();
      update(job.id, { status: "saving", worker: undefined, waitingFor: undefined, message: undefined, ahead: undefined, busy: undefined, prioritized: undefined });
    }
    for (const passage of passages) {
      signal.throwIfAborted();
      const req = {
        text: passage.text, voice: job.voice.id, engine: job.voice.engine, openaiModel: job.openaiModel, docId: job.docId,
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
      update(job.id, { status: "queued", worker: undefined, waitingFor: undefined, message: "Waiting for the speech server to reconnect…" });
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
