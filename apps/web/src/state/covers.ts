import { request } from "@readaloud/practice/request";
import { useEffect } from "react";
import { create } from "zustand";
import type { CoverEntry, CoverLibrary, CoverSummary, DocCovers } from "../lib/coverProtocol";
import { isBundledApp } from "../lib/native";

/** Still to come: worth asking the server again. */
export const coverPending = (cover: Pick<CoverEntry, "status">) => cover.status === "queued" || cover.status === "generating";

interface CoverState {
  /** Whether the server can draw covers; null until it has said. */
  configured: boolean | null;
  /** The day's limit on new art is reached; what is queued waits. */
  paused: boolean;
  /** Each document's article cover, for the Library. */
  shelf: Record<string, CoverSummary>;
  /** The covers of documents that have been opened. */
  docs: Record<string, DocCovers>;
  refresh: () => Promise<void>;
  /** A document's covers as the server has them now; null when it has none. */
  load: (docId: string) => Promise<DocCovers | null>;
  /** Ask for a document's covers to be made. `retry` also asks again for the ones that failed. */
  ensure: (docId: string, retry?: boolean) => Promise<DocCovers | null>;
}

const inFlight = new Map<string, Promise<DocCovers | null>>();
/** Names the Library's covers as last answered, so an unchanged answer is not sent again. */
let shelfTag: string | null = null;
const place = (docId: string) => `/api/covers/docs/${encodeURIComponent(docId)}`;

export const useCovers = create<CoverState>((set, get) => {
  const keep = (covers: DocCovers) => {
    const article = covers.covers[0];
    set({
      docs: { ...get().docs, [covers.docId]: covers },
      shelf: {
        ...get().shelf,
        [covers.docId]: {
          status: article.status, ...(article.url ? { url: article.url } : {}),
          pending: covers.covers.filter(coverPending).length, failed: covers.covers.filter((cover) => cover.status === "failed").length,
        },
      },
    });
    return covers;
  };
  return {
    configured: null,
    paused: false,
    shelf: {},
    docs: {},
    async refresh() {
      const response = await request("/api/covers/", { timeoutMs: 15_000, ...(shelfTag ? { headers: { "if-none-match": shelfTag } } : {}) });
      if (response.status === 304) return;
      if (!response.ok) throw new Error("Cover service is unavailable.");
      const data = await response.json() as CoverLibrary;
      shelfTag = response.headers.get("etag");
      set({ configured: data.configured, paused: data.paused, shelf: data.docs });
    },
    async load(docId) {
      const response = await request(place(docId), { timeoutMs: 15_000 });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Cover service is unavailable.");
      return keep(await response.json() as DocCovers);
    },
    ensure(docId, retry = false) {
      const key = `${docId}\n${retry}`;
      const existing = inFlight.get(key);
      if (existing) return existing;
      const task = (async () => {
        const response = await request(`${place(docId)}/ensure`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry }), timeoutMs: 15_000,
        });
        // No key on this server, or covers switched off: there is nothing to wait for.
        if (response.status === 503) { set({ configured: false }); return null; }
        // The document has not reached the server yet; it gets its covers when it does.
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Could not make covers.");
        set({ configured: true });
        return keep(await response.json() as DocCovers);
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, task);
      return task;
    },
  };
});

/** Keeps the Library's covers current: often while art is being drawn, rarely otherwise. */
export function startCoverSync() {
  // Files inside the iOS app have no server behind them, so there are no covers to ask for.
  if (isBundledApp()) return () => {};
  let stopped = false, busy = false, last = 0;
  const sync = async () => {
    if (stopped || busy || document.visibilityState !== "visible") return;
    busy = true;
    last = Date.now();
    try { await useCovers.getState().refresh(); }
    catch { /* Offline or an older server: the Library shows its usual marks. */ }
    finally { busy = false; }
  };
  const timer = setInterval(() => {
    const { shelf, paused, configured } = useCovers.getState();
    if (configured === false) return;
    const drawing = !paused && Object.values(shelf).some((cover) => cover.pending > 0);
    if (Date.now() - last >= (drawing ? 5000 : 60_000)) void sync();
  }, 5000);
  const visible = () => { if (Date.now() - last >= 5000) void sync(); };
  document.addEventListener("visibilitychange", visible);
  void sync();
  return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
}

/**
 * The covers of the document being read. Asks for them once it is open, then follows the
 * drawing until every one is ready, failed or has nothing to draw from. `version` changes
 * with the text, so an edited document is checked again.
 */
export function useDocCovers(docId: string | undefined, version: string, enabled: boolean): DocCovers | undefined {
  const covers = useCovers((s) => docId ? s.docs[docId] : undefined);
  useEffect(() => {
    if (!docId || !enabled || isBundledApp()) return;
    let alive = true, tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = (ask: boolean, delay: number) => { timer = setTimeout(() => void follow(ask), delay); };
    const follow = async (ask: boolean) => {
      const state = useCovers.getState();
      let found: DocCovers | null = null;
      try { found = ask ? await state.ensure(docId) : await state.load(docId); }
      catch { if (alive && tries++ < 5) again(ask, 8000); return; }
      if (!alive || useCovers.getState().configured === false) return;
      // Not on the server yet (it syncs within seconds of being added): ask again shortly.
      if (!found) { if (tries++ < 5) again(true, 4000); return; }
      if (found.covers.some(coverPending)) again(false, 4000);
    };
    void follow(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [docId, version, enabled]);
  return covers;
}
