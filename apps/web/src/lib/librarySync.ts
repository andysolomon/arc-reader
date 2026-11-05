import { create } from "zustand";
import { db, pendingChange, subscribeLibraryWrites } from "./db";
import type { LibrarySnapshot, PendingChange } from "./libraryProtocol";

interface SyncState {
  status: "syncing" | "synced" | "offline";
  pending: number;
  error: string | null;
}
export const useLibrarySync = create<SyncState>(() => ({ status: "syncing", pending: 0, error: null }));

/** Import legacy browser records once. The server merges IDs and newest edits; nothing is cleared. */
async function migrate() {
  const d = await db();
  const tx = d.transaction(["docs", "positions", "outbox", "meta"], "readwrite");
  if (!await tx.objectStore("meta").get("shared-library-imported")) {
    const outbox = tx.objectStore("outbox");
    for (const record of await tx.objectStore("docs").getAll()) {
      const key = `doc:${record.id}`;
      if (!await outbox.get(key)) await outbox.put(pendingChange(key, { kind: "doc", record }));
    }
    for (const record of await tx.objectStore("positions").getAll()) {
      const key = `position:${record.docId}`;
      if (!await outbox.get(key)) await outbox.put(pendingChange(key, { kind: "position", record }));
    }
    await tx.objectStore("meta").put(true, "shared-library-imported");
  }
  await tx.done;
}

/** Acknowledge only the exact writes sent. Edits made during the request remain pending. */
async function apply(snapshot: LibrarySnapshot, sent: PendingChange[]) {
  const d = await db();
  const tx = d.transaction(["docs", "positions", "outbox"], "readwrite");
  const outbox = tx.objectStore("outbox");
  for (const item of sent) {
    if ((await outbox.get(item.key))?.token === item.token) await outbox.delete(item.key);
  }
  const pending = new Set(await outbox.getAllKeys());
  for (const record of snapshot.docs) {
    if (!pending.has(`doc:${record.id}`)) await tx.objectStore("docs").put(record);
  }
  for (const record of snapshot.positions) {
    if (!pending.has(`position:${record.docId}`) && !pending.has(`doc:${record.docId}`)) await tx.objectStore("positions").put(record);
  }
  for (const id of snapshot.deleted) {
    // Deletion always wins, including over an offline edit or a legacy import.
    await tx.objectStore("docs").delete(id);
    await tx.objectStore("positions").delete(id);
    await outbox.delete(`doc:${id}`);
    await outbox.delete(`position:${id}`);
  }
  await tx.done;
}

let inflight: Promise<boolean> | null = null;
export function syncLibrary(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    // Quiet background pulls should not announce "Syncing" every five seconds.
    if (useLibrarySync.getState().status !== "synced") useLibrarySync.setState({ status: "syncing", error: null });
    try {
      await migrate();
      const d = await db();
      // Snapshot the queue: new writes can wait for the next sync, avoiding starvation during playback.
      const queued = await d.getAll("outbox");
      if (queued.length) useLibrarySync.setState({ status: "syncing", pending: queued.length });
      const batches: PendingChange[][] = [[]];
      let size = 0;
      for (const item of queued) {
        const bytes = new TextEncoder().encode(JSON.stringify(item.change)).length;
        if (size + bytes > 8 * 1024 * 1024 || batches.at(-1)!.length >= 100) { batches.push([]); size = 0; }
        batches.at(-1)!.push(item);
        size += bytes;
      }
      for (const sent of batches) {
        const response = await fetch("/api/library/sync", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ changes: sent.map((item) => item.change) }),
          signal: AbortSignal.timeout(20_000), cache: "no-store",
        });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Library server unavailable.");
        const snapshot = await response.json() as LibrarySnapshot;
        if (!Array.isArray(snapshot.docs) || !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.deleted)) throw new Error("Library server unavailable.");
        await apply(snapshot, sent);
      }
      const pending = await d.count("outbox");
      useLibrarySync.setState({ status: pending ? "syncing" : "synced", pending, error: null });
      return true;
    } catch (error) {
      const pending = await db().then((d) => d.count("outbox")).catch(() => 0);
      useLibrarySync.setState({ status: "offline", pending, error: (error as Error).message });
      return false;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Pull other clients' changes, retry offline writes, and refresh promptly on reconnect/focus. */
export function startLibrarySync(onChange: () => void) {
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    await syncLibrary();
    if (!stopped) onChange();
  };
  const unsubscribe = subscribeLibraryWrites(() => {
    onChange();
    useLibrarySync.setState({ status: "syncing" });
    clearTimeout(debounce);
    debounce = setTimeout(() => { void run(); }, 400);
  });
  const visible = () => { if (document.visibilityState === "visible") void run(); };
  const timer = setInterval(visible, 5000);
  window.addEventListener("online", run);
  window.addEventListener("focus", visible);
  document.addEventListener("visibilitychange", visible);
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(debounce);
    unsubscribe();
    window.removeEventListener("online", run);
    window.removeEventListener("focus", visible);
    document.removeEventListener("visibilitychange", visible);
  };
}
