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
}
/** Retrying is silent by design, but a reader watching "0 of 55" should know nothing is arriving. */
const waiting = (id: string, done: number, total: number): PreparationStatus => ({ id, state: "running", done, total, unreachable: true });
const sessions = new Map<string, PreparationSession>();
class PreparationHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const isTransientPreparationError = (error: unknown) => error instanceof TypeError || (error as Error)?.name === "AbortError"
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

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
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

async function submit(requests: PreparationRequest[], start: number, fingerprint: string, signal: AbortSignal, unreachable: () => void): Promise<SavedPreparation> {
  let entry = saved().find((job) => job.signature === fingerprint && job.active);
  if (!entry) {
    const existing = shared.find((job) => (job.state === "running" || job.available.length === job.total) && matches(job, requests));
    if (existing) {
      entry = { id: existing.id, signature: fingerprint, keys: existing.keys, active: existing.state === "running" };
      save([...saved().filter((job) => job.signature !== fingerprint), entry]);
    }
  }
  if (!entry) {
    // Do not abort the submission: if Cancel races the response, obtain the job id
    // first so the server job can be cancelled explicitly.
    let status: PreparationStatus;
    for (;;) {
      signal?.throwIfAborted();
      try {
        status = await json<PreparationStatus>("", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests, start }),
        });
        break;
      } catch (error) {
        signal?.throwIfAborted();
        if (!isTransientPreparationError(error)) throw error;
        unreachable();
        await delay(signal);
      }
    }
    entry = { id: status.id, signature: fingerprint, keys: requests.map((r) => r.key), active: true };
    save([...saved().filter((job) => job.signature !== fingerprint), entry]);
  }
  return entry;
}

/** Identical readings share a submission; polling only observes it. A reader
 * cancels server work only when no other reader still needs that job. */
export async function prepareAudio(requests: PreparationRequest[], start: number, progress?: PreparationProgress, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const fingerprint = signature(requests);
  let session = sessions.get(fingerprint);
  if (!session) {
    const controller = new AbortController();
    const observers = new Set<PreparationObserver>();
    const unreachable = () => { for (const other of observers) if (!other.signal?.aborted) other.progress?.(0, requests.length, waiting("", 0, requests.length)); };
    session = { entry: submit(requests, start, fingerprint, controller.signal, unreachable), observers, cancelled: false, controller };
    sessions.set(fingerprint, session);
  }
  const observer = { signal, progress };
  session.observers.add(observer);
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
    id = (await session.entry).id;
    if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
    let done = 0, total = requests.length;
    for (;;) {
      let status: PreparationStatus;
      try {
        status = await json<PreparationStatus>(`/${id}`, { signal });
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
