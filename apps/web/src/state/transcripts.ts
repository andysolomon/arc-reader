import { create } from "zustand";
import { docs, type DocRecord } from "../lib/db";
import { isXPost, startTranscript, transcriptStatus, withTranscript, type TranscriptStatus } from "../lib/videoTranscript";
import { usePlayer } from "./player";
import { useLibrary } from "./library";
import { toast } from "./toast";

const POLL_MS = 2000;
/** A phone changing networks misses a few answers; this many in a row and the server is out of reach. */
const LOST_AFTER = 15;

interface TranscriptsState {
  /** What the server last said about the video on each document's post, by document */
  videos: Record<string, TranscriptStatus>;
  /** Offers turned down for now, by document */
  dismissed: Record<string, boolean>;
  /** Ask whether the document's post has a video, and follow a transcription already under way. */
  look: (rec: DocRecord) => Promise<void>;
  /** Transcribe the video and add what is said to the document. */
  request: (rec: DocRecord) => Promise<void>;
  dismiss: (docId: string) => void;
}

const busy = (status: TranscriptStatus | undefined) => status?.state === "waiting" || status?.state === "fetching" || status?.state === "transcribing";
export const transcribing = busy;

/** Documents whose transcription is being followed */
const following = new Set<string>();
let pollMs = POLL_MS;
/** Tests poll without the wait. */
export const setTranscriptPolling = (ms: number) => { pollMs = ms; };

export const useTranscripts = create<TranscriptsState>()((set, get) => {
  const put = (id: string, status: TranscriptStatus) => set((s) => ({ videos: { ...s.videos, [id]: status } }));
  const fail = (id: string, error: string) => put(id, { ...get().videos[id], state: "failed", error });

  /** The transcript goes into the newest saved copy, so a sync or voice change in the meantime is kept. */
  const add = async (id: string, status: TranscriptStatus) => {
    const latest = await docs.get(id);
    if (!latest) return;
    if (!latest.transcript) {
      const next = withTranscript(latest, status.text ?? "", status.seconds ?? 0);
      await docs.put(next);
      const player = usePlayer.getState();
      // The post's own words still come first, so the place in them holds.
      if (player.record?.id === id) await player.open(next, { autoplay: player.playing, resume: true });
      void useLibrary.getState().refresh();
      toast("Transcript added");
    }
    set((s) => ({ videos: Object.fromEntries(Object.entries(s.videos).filter(([key]) => key !== id)) }));
  };

  const follow = async (id: string, url: string) => {
    if (following.has(id)) return;
    following.add(id);
    try {
      for (let missed = 0; ;) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        let status: TranscriptStatus;
        try {
          status = await transcriptStatus(url);
          missed = 0;
        } catch {
          if (++missed < LOST_AFTER) continue;
          return fail(id, "Lost touch with the server. Open this post again to see whether its transcript is ready.");
        }
        if (status.state === "done") return await add(id, status);
        // Work in progress does not outlive a restart of the server.
        if (status.state === "none") return fail(id, "The server restarted before the transcript was finished. Please retry.");
        put(id, status);
        if (status.state === "failed") return;
      }
    } catch (error) {
      fail(id, error instanceof Error ? error.message : "Adding the transcript failed. Please retry.");
    } finally {
      following.delete(id);
    }
  };

  return {
    videos: {},
    dismissed: {},
    async look(rec) {
      const url = rec.meta?.url;
      if (rec.transcript || !url || !isXPost(url) || get().videos[rec.id] || following.has(rec.id)) return;
      let status: TranscriptStatus;
      // Offline, or a server without this route: the post simply has no offer.
      try { status = await transcriptStatus(url); } catch { return; }
      if (get().videos[rec.id]) return;
      put(rec.id, status);
      if (busy(status)) void follow(rec.id, url);
    },
    async request(rec) {
      const url = rec.meta?.url;
      if (!url || busy(get().videos[rec.id]) || following.has(rec.id)) return;
      const { error: _, ...known } = get().videos[rec.id] ?? { state: "none" as const };
      put(rec.id, { ...known, state: "waiting", done: 0 });
      try {
        const status = await startTranscript(url);
        if (status.state === "done") return await add(rec.id, status);
        put(rec.id, status);
        void follow(rec.id, url);
      } catch (error) {
        fail(rec.id, error instanceof Error ? error.message : "Transcribing the video failed. Please retry.");
      }
    },
    dismiss(docId) {
      set((s) => ({ dismissed: { ...s.dismissed, [docId]: true } }));
    },
  };
});
