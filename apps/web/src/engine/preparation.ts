import { hash } from "../lib/hash";
import { audioCache } from "../lib/db";

export interface PreparationRequest {
  key: string;
  text: string;
  voice: string;
  engine: string;
  profile?: boolean;
  protocol: "openai" | "readaloud";
  /** Already available in this browser; it needs no server generation. */
  cached?: boolean;
}
export interface PreparationStatus {
  id: string;
  state: "running" | "done" | "cancelled" | "error";
  done: number;
  total: number;
  error?: string;
  queued?: boolean;
  worker?: string;
  /** The only machine a queued reading can run on, when the other can't take it. */
  waitingFor?: string;
  /** The app's own server is not answering; the request is being retried. */
  unreachable?: boolean;
  /** Waiting readings that will be prepared before this one. */
  ahead?: number;
  /** A reader moved it to the front of the queue. */
  prioritized?: boolean;
  /** Its machine is preparing another reading. */
  busy?: boolean;
  /** The reading is on its way to the server, which has not accepted it yet. */
  submitting?: boolean;
}
export interface SharedPreparation extends PreparationStatus {
  keys: string[];
  /** Indices actually rendered on the server; device-only cache hits are excluded. */
  available: number[];
  deviceOnly?: number[];
  voice: string;
  engine: string;
  profile?: boolean;
  createdAt: number;
}
let shared: SharedPreparation[] = [];
let sharing = 0;
export const sharedAudioRemaining = () => sharing;
export async function refreshPreparationCatalog(): Promise<SharedPreparation[]> {
  const result = await json<{ jobs: SharedPreparation[] }>("", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!Array.isArray(result.jobs)) throw new Error("Server audio status is unavailable.");
  shared = result.jobs;
  const local = new Set(await audioCache.keys().catch(() => []));
  const uploads = new Map<string, { id: string; index: number }>();
  for (const job of shared) for (const index of job.deviceOnly || []) {
    const key = job.keys[index];
    if (local.has(key) && !uploads.has(key)) uploads.set(key, { id: job.id, index });
  }
  sharing = uploads.size;
  let sent = 0;
  // Share a small batch of existing clips each poll, keeping mobile memory/network bounded.
  for (const [key, target] of [...uploads].slice(0, 8)) {
    const clip = await audioCache.get(key);
    if (!clip) continue;
    const response = await fetch(`${BASE}/${target.id}/audio/${target.index}`, {
      method: "PUT", headers: { "content-type": clip.mime, "x-duration": String(clip.duration), ...(clip.words ? { "x-word-timings": JSON.stringify(clip.words) } : {}) },
      body: clip.blob, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Could not share saved audio. It remains on this device; sync will retry.");
    sent++;
  }
  if (sent) {
    const updated = await json<{ jobs: SharedPreparation[] }>("", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!Array.isArray(updated.jobs)) throw new Error("Server audio status is unavailable.");
    shared = updated.jobs;
    sharing = Math.max(0, sharing - sent);
  }
  return shared;
}
/** Move a waiting server reading to the front of its queue; `now` also pauses the reading its machine is on. */
export function prioritizePreparation(id: string, now = false): Promise<PreparationStatus> {
  return json<PreparationStatus>(`/${id}/priority`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ now }), signal: AbortSignal.timeout(10_000),
  });
}
export function serverPreparedKeys(): string[] {
  return [...new Set(shared.flatMap((job) => job.available.map((index) => job.keys[index])))];
}
const matches = (job: SharedPreparation, requests: PreparationRequest[]) => job.keys.length === requests.length && job.keys.every((key, i) => key === requests[i].key);
interface SavedPreparation {
  id: string;
  signature: string;
  keys: string[];
  active: boolean;
}
type PreparationProgress = (done: number, total: number, status?: PreparationStatus) => void;
interface PreparationObserver { signal?: AbortSignal; progress?: PreparationProgress }
interface PreparationSession {
  entry: Promise<SavedPreparation>;
  observers: Set<PreparationObserver>;
  cancelled: boolean;
  controller: AbortController;
  /** What a reader sees until the server has accepted the reading. */
  submitting?: PreparationStatus;
}
/** Retrying is silent by design, but a reader watching "0 of 55" should know nothing is arriving. */
const waiting = (id: string, done: number, total: number): PreparationStatus => ({ id, state: "running", done, total, unreachable: true });
/** Nothing is queued anywhere until the server answers, so a reading is not "waiting for a machine" yet. */
const sending = (total: number): PreparationStatus => ({ id: "", state: "running", done: 0, total, submitting: true });
const sessions = new Map<string, PreparationSession>();
class PreparationHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const isTransientPreparationError = (error: unknown) => error instanceof TypeError || ["AbortError", "TimeoutError"].includes((error as Error)?.name)
  || (error instanceof PreparationHttpError && (error.status === 408 || error.status === 429 || error.status >= 500));
const STORAGE = "readaloud:preparations";
const BASE = "/api/preparations";
// Retain the mapping even when browser storage is unavailable.
let memory: SavedPreparation[] = [];
function saved(): SavedPreparation[] {
  try { memory = JSON.parse(localStorage.getItem(STORAGE) || "[]"); } catch { /* private mode */ }
  return memory;
}
function save(entries: SavedPreparation[]) {
  // A long-running reading must retain its audio mapping even when many shorter
  // concurrent readings finish before it does.
  memory = entries.filter((entry, index) => entry.active || index >= entries.length - 20);
  try { localStorage.setItem(STORAGE, JSON.stringify(memory)); } catch { /* private mode */ }
}
const signature = (requests: PreparationRequest[]) => hash(JSON.stringify(requests.map(({ cached: _, ...request }) => request)));

export function hasActivePreparation(requests: PreparationRequest[]): boolean {
  return saved().some((job) => job.signature === signature(requests) && job.active)
    || shared.some((job) => job.state === "running" && matches(job, requests));
}

// A request on a stalled connection (a phone whose tunnel dropped) can hang for minutes
// without failing. Give up instead, so the reader is told and the request is retried.
const STATUS_TIMEOUT_MS = 10_000;
const SUBMIT_TIMEOUT_MS = 20_000;
/** A submission carries the whole reading's text; allow a slow uplink 10 KB a second. */
const submitTimeout = (body: string) => Math.max(SUBMIT_TIMEOUT_MS, body.length / 10);

async function json<T>(path: string, init?: RequestInit, timeout?: number): Promise<T> {
  if (!timeout) return answer<T>(await fetch(`${BASE}${path}`, init));
  const outer = init?.signal;
  const controller = new AbortController();
  const cancel = () => controller.abort(outer?.reason);
  const timer = setTimeout(() => controller.abort(new DOMException("The server did not answer in time.", "TimeoutError")), timeout);
  if (outer?.aborted) cancel();
  else outer?.addEventListener("abort", cancel, { once: true });
  try {
    // The body is read inside the time limit too.
    return await answer<T>(await fetch(`${BASE}${path}`, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", cancel);
  }
}

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new PreparationHttpError(response.status, detail?.error || `Audio preparation failed (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function delay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, 1500);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function submit(requests: PreparationRequest[], start: number, fingerprint: string, signal: AbortSignal, report: (status: PreparationStatus) => void): Promise<SavedPreparation> {
  let entry = saved().find((job) => job.signature === fingerprint && job.active);
  if (!entry) {
    const existing = shared.find((job) => (job.state === "running" || job.available.length === job.total) && matches(job, requests));
    if (existing) {
      entry = { id: existing.id, signature: fingerprint, keys: existing.keys, active: existing.state === "running" };
      save([...saved().filter((job) => job.signature !== fingerprint), entry]);
    }
  }
  if (!entry) {
    // Do not abort the submission on Cancel: if Cancel races the response, obtain the job
    // id first so the server job can be cancelled explicitly. A submission that gets no
    // answer is given up and sent again; the server returns the reading it already has
    // for the same passages, so a late arrival is not prepared twice.
    const body = JSON.stringify({ requests, start });
    let status: PreparationStatus;
    report(sending(requests.length));
    for (;;) {
      signal?.throwIfAborted();
      try {
        status = await json<PreparationStatus>("", { method: "POST", headers: { "Content-Type": "application/json" }, body }, submitTimeout(body));
        break;
      } catch (error) {
        signal?.throwIfAborted();
        if (!isTransientPreparationError(error)) throw error;
        report(waiting("", 0, requests.length));
        await delay(signal);
      }
    }
    entry = { id: status.id, signature: fingerprint, keys: requests.map((r) => r.key), active: true };
    save([...saved().filter((job) => job.signature !== fingerprint), entry]);
  }
  return entry;
}

/** Readings on their way to the server, by passage key. */
const submitting = new Map<string, Promise<void>>();
const SUBMISSION_WAIT_MS = 3000;
/**
 * Say that these passages are about to be submitted; call the result once the server has
 * the reading (or will not get it). Until then `preparedAudio` holds playback back briefly,
 * so it joins the server's work instead of asking the speech server for the same passage
 * at the same moment.
 */
export function announcePreparation(keys: string[]): () => void {
  let settle!: () => void;
  const pending = new Promise<void>((resolve) => { settle = resolve; });
  for (const key of keys) submitting.set(key, pending);
  return () => {
    for (const key of keys) if (submitting.get(key) === pending) submitting.delete(key);
    settle();
  };
}

/** Identical readings share a submission; polling only observes it. A reader
 * cancels server work only when no other reader still needs that job.
 * `submitted` is called once the server has the reading, or has refused it. */
export async function prepareAudio(requests: PreparationRequest[], start: number, progress?: PreparationProgress, signal?: AbortSignal, submitted?: () => void) {
  signal?.throwIfAborted();
  const fingerprint = signature(requests);
  let session = sessions.get(fingerprint);
  if (!session) {
    const controller = new AbortController();
    const observers = new Set<PreparationObserver>();
    const created: PreparationSession = { entry: undefined as never, observers, cancelled: false, controller };
    const report = (status: PreparationStatus) => {
      created.submitting = status;
      for (const other of observers) if (!other.signal?.aborted) other.progress?.(0, requests.length, status);
    };
    created.entry = submit(requests, start, fingerprint, controller.signal, report);
    session = created;
    sessions.set(fingerprint, session);
  }
  const observer = { signal, progress };
  session.observers.add(observer);
  // A reader who joins before the server has answered sees where the submission stands.
  if (session.submitting) progress?.(0, requests.length, session.submitting);
  let id: string | undefined;
  const cancel = () => {
    if (session.cancelled || [...session.observers].some((other) => !other.signal?.aborted)) return;
    session.controller.abort();
    if (!id) return;
    session.cancelled = true;
    if (sessions.get(fingerprint) === session) sessions.delete(fingerprint);
    save(saved().map((job) => job.id === id ? { ...job, active: false } : job));
    void fetch(`${BASE}/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    try { id = (await session.entry).id; }
    finally { session.submitting = undefined; submitted?.(); }
    if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
    let done = 0, total = requests.length;
    for (;;) {
      let status: PreparationStatus;
      try {
        status = await json<PreparationStatus>(`/${id}`, { signal }, STATUS_TIMEOUT_MS);
      } catch (error) {
        signal?.throwIfAborted();
        // A suspended phone can lose its connection. The job remains on the
        // server; retry observing it when the browser has connectivity again.
        if (!isTransientPreparationError(error)) {
          save(saved().map((job) => job.id === id ? { ...job, active: false } : job));
          throw error;
        }
        progress?.(done, total, waiting(id, done, total));
        await delay(signal);
        continue;
      }
      ({ done, total } = status);
      progress?.(status.done, status.total, status);
      if (status.state !== "running") {
        save(saved().map((job) => job.id === id ? { ...job, active: false } : job));
        if (status.state === "error") throw new Error(status.error || "Could not prepare audio. Please retry.");
        if (status.state === "cancelled") throw new Error("Audio preparation was cancelled.");
        return;
      }
      await delay(signal);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    session.observers.delete(observer);
    if (!session.observers.size && sessions.get(fingerprint) === session) sessions.delete(fingerprint);
  }
}

/** Fetch a server-rendered clip before attempting another generation. */
export async function preparedAudio(key: string, signal?: AbortSignal): Promise<Response | null> {
  const pending = submitting.get(key);
  if (pending) {
    // A slow submission never holds playback for long: ordinary generation remains available.
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, SUBMISSION_WAIT_MS);
      signal?.addEventListener("abort", finish, { once: true });
      void pending.then(finish);
    });
    signal?.throwIfAborted();
  }
  const ready = shared.find((job) => job.available.some((index) => job.keys[index] === key));
  const running = shared.find((job) => job.state === "running" && job.keys.includes(key));
  const entry = ready || saved().slice().reverse().find((job) => job.keys.includes(key)) || running;
  if (!entry) return null;
  const response = await fetch(`${BASE}/${entry.id}/audio/${entry.keys.indexOf(key)}`, { signal });
  // The server cache may have expired. Ordinary generation remains available.
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new PreparationHttpError(response.status, data?.error || "Could not fetch prepared audio.");
  }
  return response;
}
