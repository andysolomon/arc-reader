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
}
interface SavedPreparation {
  id: string;
  signature: string;
  keys: string[];
  active: boolean;
}
class PreparationHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const STORAGE = "readaloud:preparations";
const BASE = "/api/preparations";
// Retain the mapping even when browser storage is unavailable.
let memory: SavedPreparation[] = [];
function saved(): SavedPreparation[] {
  try { memory = JSON.parse(localStorage.getItem(STORAGE) || "[]"); } catch { /* private mode */ }
  return memory;
}
function save(entries: SavedPreparation[]) {
  memory = entries;
  try { localStorage.setItem(STORAGE, JSON.stringify(entries)); } catch { /* private mode */ }
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

/** One submission owns the entire render; polling only observes it. */
export async function prepareAudio(requests: PreparationRequest[], start: number, progress?: (done: number, total: number) => void, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const fingerprint = signature(requests);
  let entry = saved().find((job) => job.signature === fingerprint && job.active);
  if (!entry) {
    // Do not abort the submission: if Cancel races the response, obtain the job id
    // first so the server job can be cancelled explicitly.
    const status = await json<PreparationStatus>("", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests, start }),
    });
    entry = { id: status.id, signature: fingerprint, keys: requests.map((r) => r.key), active: true };
    save([...saved().filter((job) => job.signature !== fingerprint), entry].slice(-20));
  }
  const id = entry.id;
  const cancel = () => {
    save(saved().map((job) => job.id === id ? { ...job, active: false } : job));
    void fetch(`${BASE}/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
    for (;;) {
      let status: PreparationStatus;
      try {
        status = await json<PreparationStatus>(`/${id}`, { signal });
      } catch (error) {
        signal?.throwIfAborted();
        // A suspended phone can lose its connection. The job remains on the
        // server; retry observing it when the browser has connectivity again.
        const transient = error instanceof TypeError || (error as Error)?.name === "AbortError"
          || (error instanceof PreparationHttpError && (error.status === 408 || error.status === 429 || error.status >= 500));
        if (!transient) {
          save(saved().map((job) => job.id === id ? { ...job, active: false } : job));
          throw error;
        }
        await delay(signal);
        continue;
      }
      progress?.(status.done, status.total);
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
    throw new Error(data?.error || "Could not fetch prepared audio.");
  }
  return response;
}
