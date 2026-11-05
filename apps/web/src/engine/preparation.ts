import { hash } from "../lib/hash";

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
}
interface SavedPreparation {
  id: string;
  signature: string;
  keys: string[];
  active: boolean;
}
interface PreparationObserver { signal?: AbortSignal }
interface PreparationSession {
  entry: Promise<SavedPreparation>;
  observers: Set<PreparationObserver>;
  cancelled: boolean;
  controller: AbortController;
}
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
  return saved().some((job) => job.signature === signature(requests) && job.active);
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

async function submit(requests: PreparationRequest[], start: number, fingerprint: string, signal: AbortSignal): Promise<SavedPreparation> {
  let entry = saved().find((job) => job.signature === fingerprint && job.active);
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
export async function prepareAudio(requests: PreparationRequest[], start: number, progress?: (done: number, total: number, status?: PreparationStatus) => void, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const fingerprint = signature(requests);
  let session = sessions.get(fingerprint);
  if (!session) {
    const controller = new AbortController();
    session = { entry: submit(requests, start, fingerprint, controller.signal), observers: new Set(), cancelled: false, controller };
    sessions.set(fingerprint, session);
  }
  const observer = { signal };
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
        await delay(signal);
        continue;
      }
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
  const entry = saved().slice().reverse().find((job) => job.keys.includes(key));
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
