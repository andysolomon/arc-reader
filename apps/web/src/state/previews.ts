import { create } from "zustand";
import { idPath, studioFetch, studioJson, type PreviewSource } from "../lib/studio";

const TIMEOUT_MS = 180_000;

export interface PreviewJob {
  status: string;
  error: string;
  url: string;
  startedAt: number;
  done: boolean;
  played: boolean;
}

interface PreviewState {
  active: { id: string; name: string } | null;
  jobs: Record<string, PreviewJob>;
  /** Voices whose preview finished this session; card status checks can't undo it. */
  ready: Record<string, true>;
  open: (id: string, name: string) => void;
  retry: (id: string) => void;
  close: () => void;
  markPlayed: (id: string) => void;
  fail: (id: string, error: string) => void;
}

// Jobs live outside the gallery component so leaving Studio doesn't abort a
// first-time render; returning shows its progress or the finished clip.
const controllers = new Map<string, AbortController>();

function patch(id: string, update: Partial<PreviewJob>) {
  usePreviews.setState((s) => s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...update } } } : s);
}

/** Drop a finished job and its audio. In-flight jobs keep running. */
function discard(id: string) {
  const job = usePreviews.getState().jobs[id];
  if (!job?.done) return;
  if (job.url) URL.revokeObjectURL(job.url);
  controllers.delete(id);
  usePreviews.setState((s) => { const jobs = { ...s.jobs }; delete jobs[id]; return { jobs }; });
}

function run(id: string) {
  controllers.get(id)?.abort();
  const old = usePreviews.getState().jobs[id];
  if (old?.url) URL.revokeObjectURL(old.url);
  const ac = new AbortController();
  controllers.set(id, ac);
  usePreviews.setState((s) => ({ jobs: { ...s.jobs, [id]: { status: "Checking preview…", error: "", url: "", startedAt: Date.now(), done: false, played: false } } }));
  const current = () => controllers.get(id) === ac;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT_MS);
  const path = `/archetypes/${idPath(id)}/preview`;
  void (async () => {
    try {
      const state = await studioJson<PreviewSource>(`${path}/state`, { signal: ac.signal, cache: "no-cache" });
      if (state.source === "no_model") throw new Error(state.message);
      if (current()) patch(id, { status: state.source === "rendering"
        ? "Generating preview on your machine. The first preview can take a minute or more on CPU; later plays use the saved audio."
        : "Loading saved preview…" });
      // Revalidate the server's saved clip on every open so a repaired
      // preview replaces bad audio without needing a full page reload.
      const response = await studioFetch(path, { signal: ac.signal, cache: "no-cache" });
      if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("VoiceStudio returned an invalid audio response. Please retry.");
      const clip = await response.blob();
      if (!clip.size) throw new Error("VoiceStudio returned an empty preview. Please retry.");
      if (!current()) return;
      usePreviews.setState((s) => ({ ready: { ...s.ready, [id]: true } }));
      // Only keep audio someone is waiting to hear; reopening revalidates anyway.
      if (usePreviews.getState().active?.id !== id) { patch(id, { done: true }); discard(id); return; }
      patch(id, { url: URL.createObjectURL(clip), done: true, status: "Preview ready. Press play if it doesn’t start automatically." });
    } catch (e) {
      if (!current()) return;
      const error = timedOut
        ? "This preview is taking longer than expected. VoiceStudio may still finish in the background. Retry to check for the saved audio."
        : e instanceof Error ? e.message : "Could not load the preview.";
      patch(id, { error, done: true });
      if (usePreviews.getState().active?.id !== id) discard(id);
    } finally { clearTimeout(timeout); }
  })();
}

export const usePreviews = create<PreviewState>()((set, get) => ({
  active: null,
  jobs: {},
  ready: {},
  open: (id, name) => {
    const previous = get().active;
    if (previous?.id === id) return;
    set({ active: { id, name } });
    if (previous) discard(previous.id);
    if (!get().jobs[id]) run(id);
  },
  retry: run,
  close: () => {
    const previous = get().active;
    set({ active: null });
    if (previous) discard(previous.id);
  },
  markPlayed: (id) => patch(id, { played: true }),
  fail: (id, error) => patch(id, { error }),
}));
