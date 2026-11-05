import { API_BASE } from "../engine/providers";

export const studioUrl = (path: string) => `${API_BASE || "/api/vs"}${path}`;
export const idPath = encodeURIComponent;

export function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorMessage).join("; ");
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["message", "detail", "error", "reason", "msg"]) {
      if (v[key]) return errorMessage(v[key]);
    }
  }
  return "VoiceStudio could not complete this request.";
}

export async function studioFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(studioUrl(path), init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body ? errorMessage(body) : `VoiceStudio returned HTTP ${response.status}`);
  }
  return response;
}
export async function studioJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await studioFetch(path, init)).json() as Promise<T>;
}
export const jsonBody = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export interface Profile { id: string; name: string; kind: "clone" | "design"; language: string; instruct?: string }
export interface ArchetypeFacets { gender?: string | null; age?: string | null; pitch?: string | null; accent?: string | null; whisper?: boolean; lang?: string }
export interface Archetype { id: string; name: string; instruct: string; language: string; use_case: string; attrs: Record<string, string>; facets?: ArchetypeFacets }
export interface PreviewSource { source: "gallery" | "cached" | "rendering" | "no_model"; message: string }
export interface Design { attrs: Record<string, string>; instruct: string; unmatched: string[] }
export interface Segment { id?: string | number; start: number; end: number; text: string; speaker?: string; profile_id?: string }
export interface Transcript { text: string; segments?: Segment[]; language?: string }
export interface TaskEvent { type?: string; event?: string; message?: string; stage?: string; error?: unknown; detail?: unknown; progress?: number; current?: number; total?: number; percent?: number }

/** Parse fetch streams rather than EventSource so cancellation and HTTP errors are observable. */
export async function readEvents(response: Response, onEvent: (event: TaskEvent) => boolean | void): Promise<void> {
  if (!response.body) throw new Error("VoiceStudio returned an empty progress stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return false;
    const event = JSON.parse(data) as TaskEvent;
    const type = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim();
    event.type ||= type;
    if (event.type === "error" || event.type === "failed") throw new Error(errorMessage(event.error || event.detail || event.message));
    if (event.type === "cancelled") throw new Error("Task cancelled.");
    return onEvent(event) === true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (dispatch(block)) return;
      }
      if (done) { if (buffer.trim()) dispatch(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function waitForTask(taskId: string, signal: AbortSignal, progress: (message: string) => void, terminal = "done") {
  let completed = false;
  await readEvents(await studioFetch(`/tasks/stream/${idPath(taskId)}`, { signal }), (event) => {
    const stages: Record<string, string> = { extract_start: "Extracting audio…", demucs_start: "Separating speech and background…", scene_start: "Preparing video…", assembling: "Assembling dubbed audio…" };
    if (event.message || event.stage) progress(event.message || event.stage!);
    else if (event.type === "progress" && event.current !== undefined && event.total) progress(`Rendering line ${event.current + 1} of ${event.total}…`);
    else if (event.type === "demucs_progress" && event.percent !== undefined) progress(`Separating speech and background · ${event.percent}%`);
    else if (event.type && stages[event.type]) progress(stages[event.type]);
    if (event.type === terminal || event.type === "done") { completed = true; return true; }
  });
  if (!completed) throw new Error("Progress disconnected before completion. Resume the task to check its result.");
}
export async function transcribe(file: File, dictation: boolean, signal: AbortSignal): Promise<Transcript> {
  const body = new FormData();
  body.set("audio", file);
  body.set("mode", "accurate");
  body.set("dictation", String(dictation));
  return studioJson<Transcript>("/transcribe", { method: "POST", body, signal });
}
export function downloadText(text: string, filename: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function subtitles(segments: Segment[]): string {
  const time = (seconds: number) => {
    const ms = Math.round(Math.max(0, seconds) * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return segments.map((s, i) => `${i + 1}\n${time(s.start)} --> ${time(s.end)}\n${s.text.trim()}\n`).join("\n");
}
