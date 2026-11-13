import { create } from "zustand";
import { db, pendingChange, subscribeLibraryWrites, type DocRecord } from "./db";
import type { LibraryDocs, LibraryManifest, PendingChange } from "./libraryProtocol";

interface SyncState {
  status: "syncing" | "synced" | "offline";
  pending: number;
  documents: number;
  error: string | null;
}
export const useLibrarySync = create<SyncState>(() => ({ status: "syncing", pending: 0, documents: 0, error: null }));

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

/**
 * Acknowledge only the exact writes sent. Edits made during the request remain pending.
 * Returns the documents this device lacks or holds an older version of.
 */
async function apply(snapshot: LibraryManifest, sent: PendingChange[]): Promise<string[]> {
  const d = await db();
  const tx = d.transaction(["docs", "positions", "outbox"], "readwrite");
  const outbox = tx.objectStore("outbox");
  for (const item of sent) {
    if ((await outbox.get(item.key))?.token === item.token) await outbox.delete(item.key);
  }
  const pending = new Set(await outbox.getAllKeys());
  const remoteDocs = new Map(snapshot.docs.map((entry) => [entry.id, entry]));
  const remotePositions = new Map(snapshot.positions.map((record) => [record.docId, record]));
  const deleted = new Set(snapshot.deleted);
  const localDocs = await tx.objectStore("docs").getAll();
  const localIds = new Set(localDocs.map((record) => record.id));
  // An import marker or an empty queue is not proof that the server has a record.
  // Recover records left by an older client, a lost queue, or a server restore.
  for (const record of localDocs) {
    const key = `doc:${record.id}`;
    const remote = remoteDocs.get(record.id);
    if (!pending.has(key) && !deleted.has(record.id) && (!remote || record.updatedAt > remote.updatedAt)) {
      await outbox.put(pendingChange(key, { kind: "doc", record }));
      pending.add(key);
    }
  }
  for (const record of await tx.objectStore("positions").getAll()) {
    const key = `position:${record.docId}`;
    const remote = remotePositions.get(record.docId);
    if (!pending.has(key) && !deleted.has(record.docId) && localIds.has(record.docId)
      && (!remote || record.updatedAt > remote.updatedAt)) {
      await outbox.put(pendingChange(key, { kind: "position", record }));
      pending.add(key);
    }
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
  const local = new Map(localDocs.map((record) => [record.id, record.updatedAt]));
  const wanted = snapshot.docs.filter((entry) => !pending.has(`doc:${entry.id}`) && !deleted.has(entry.id)
    && !((local.get(entry.id) ?? -1) >= entry.updatedAt)).map((entry) => entry.id);
  await tx.done;
  return wanted;
}

/** Store fetched documents, unless this device has an edit or deletion on its way up. */
async function store(records: DocRecord[]) {
  const d = await db();
  const tx = d.transaction(["docs", "outbox"], "readwrite");
  for (const record of records) {
    if (!await tx.objectStore("outbox").get(`doc:${record.id}`)) await tx.objectStore("docs").put(record);
  }
  await tx.done;
}

/**
 * Download document bodies a few at a time. Each answer is stored as it arrives, so a
 * weak connection that drops partway keeps what it got and the next sync asks only for the rest.
 */
async function download(ids: string[]) {
  let remaining = ids;
  while (remaining.length) {
    const response = await fetch("/api/library/docs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: remaining }), signal: AbortSignal.timeout(30_000), cache: "no-store",
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Library server unavailable.");
    const result = await response.json() as LibraryDocs;
    if (!Array.isArray(result.docs) || !Array.isArray(result.missing) || (!result.docs.length && !result.missing.length)) throw new Error("Library server unavailable.");
    await store(result.docs);
    const answered = new Set([...result.docs.map((record) => record.id), ...result.missing]);
    remaining = remaining.filter((id) => !answered.has(id));
  }
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
      let snapshot: LibraryManifest | undefined;
      // A second round immediately uploads any local records recovered during reconciliation.
      for (let round = 0; round < 2; round++) {
        // Bound each round so continuous playback writes cannot starve completion.
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
        let wanted: string[] = [];
        for (const sent of batches) {
          // The answer lists document versions, not bodies, so a quiet poll stays a few kilobytes.
          const response = await fetch("/api/library/sync", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ changes: sent.map((item) => item.change), view: "manifest" }),
            signal: AbortSignal.timeout(20_000), cache: "no-store",
          });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Library server unavailable.");
          snapshot = await response.json() as LibraryManifest;
          if (!Array.isArray(snapshot.docs) || !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.deleted)) throw new Error("Library server unavailable.");
          wanted = await apply(snapshot, sent);
        }
        await download(wanted);
        if (!await d.count("outbox")) break;
      }
      const pending = await d.count("outbox");
      const localIds = (await d.getAllKeys("docs")).sort();
      const serverIds = snapshot!.docs.map((record) => record.id).sort();
      if (!pending && JSON.stringify(localIds) !== JSON.stringify(serverIds)) throw new Error("The library has not finished syncing. Try syncing again.");
      useLibrarySync.setState({ status: pending ? "syncing" : "synced", pending, documents: localIds.length, error: null });
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
