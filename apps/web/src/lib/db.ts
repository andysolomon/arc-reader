import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { readsOf, type LibraryChange, type PendingChange } from "./libraryProtocol";
import { uid } from "./hash";
import type { DocLink } from "./links";

export type DocSource = "paste" | "url" | "file" | "share" | "sample";

/** Catalogue details for research: read from the page when fetched, editable in the Reader. */
export interface DocMeta {
  /** The original link, for citing and revisiting */
  url?: string;
  author?: string;
  /** As published: a YYYY-MM-DD date when the page gave one */
  published?: string;
  /** Publication or site name */
  site?: string;
  /** The page's own description */
  description?: string;
  /** Your research notes */
  notes?: string;
}

/** A chapter's place in a book that was imported as one document per chapter. */
export interface DocBook {
  /** The same on every chapter of the book */
  id: string;
  /** The book's title; the document's own title is the chapter's */
  title: string;
  /** This chapter's number, from 1 */
  chapter: number;
  /** Chapters in the book, whether or not they are in the library */
  chapters: number;
}

/** Library category: suggested by Jev (with its confidence) or chosen by you. */
export interface DocCategory {
  name: string;
  by: "jev" | "you";
  /** Jev's confidence in its pick, 0..1 */
  confidence?: number;
  model?: string;
  at: number;
}

/** Jev's view of whether a document deserves a paid (premium) narration. */
export type PremiumFitLevel = "strong" | "good" | "weak";
export interface PremiumFit {
  fit: PremiumFitLevel;
  /** Jev's confidence in its pick, 0..1 */
  confidence?: number;
  model?: string;
  /** Fingerprint of the text that was judged (see summarySource) */
  source: string;
  at: number;
}

export interface DocRecord {
  id: string;
  title: string;
  text: string;
  /** Cached adaptation; the original text remains intact. */
  patois?: { sourceText: string; text: string; version: number };
  /** LLM summary of `text`; `source` fingerprints the text it was made from. */
  summary?: { source: string; text: string; model: string; version: number; createdAt: number };
  /** Spoken explanations keyed by code content, shared across voices and devices. */
  codeSummaries?: Record<string, string>;
  /** Cached descriptions keyed by visual source, alt text, and caption. */
  visualDescriptions?: Record<string, string>;
  meta?: DocMeta;
  book?: DocBook;
  category?: DocCategory;
  /** When you favorited it. Favorites are assessed as candidates for a premium read. */
  favoritedAt?: number;
  premium?: PremiumFit;
  source: DocSource;
  /** Hostname for URLs, file name for uploads, "Pasted text" otherwise */
  domain: string;
  /** Hyperlinks to other sites, in document order and without duplicates. */
  links?: DocLink[];
  /** Per-document voice override */
  voice: string | null;
  chars: number;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRecord {
  docId: string;
  variant?: "original" | "patois";
  narrationVersion?: number;
  index: number;
  /** seconds into the sentence at 1× */
  offset: number;
  /** 0..1 */
  fraction: number;
  /** total duration estimate at 1× */
  total: number;
  /** Complete readings so far; survives rereads, which restart the fraction. */
  reads?: number;
  updatedAt: number;
}

export interface WordTiming {
  start: number;
  end: number;
}

export interface AudioRecord {
  key: string;
  blob: Blob;
  mime: string;
  duration: number;
  words?: WordTiming[];
  /** Sentence starts inside a passage clip (see Chunk.starts); recorded with the words the clip was planned from. */
  starts?: number[];
  lead?: number;
  tail?: number;
  loudness?: number;
  /** See Chunk.voiced; absent on clips stored before it was measured. */
  voiced?: number;
  createdAt: number;
}

interface Schema extends DBSchema {
  docs: { key: string; value: DocRecord; indexes: { updatedAt: number } };
  positions: { key: string; value: PositionRecord };
  audio: { key: string; value: AudioRecord; indexes: { createdAt: number } };
  outbox: { key: string; value: PendingChange };
  meta: { key: string; value: boolean };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>("readaloud", 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const docs = d.createObjectStore("docs", { keyPath: "id" });
          docs.createIndex("updatedAt", "updatedAt");
          d.createObjectStore("positions", { keyPath: "docId" });
          const audio = d.createObjectStore("audio", { keyPath: "key" });
          audio.createIndex("createdAt", "createdAt");
        }
        d.createObjectStore("outbox", { keyPath: "key" });
        d.createObjectStore("meta");
      },
      blocking() { void dbp?.then((d) => d.close()); dbp = null; },
      terminated() { dbp = null; },
    });
    const opening = dbp;
    opening.catch(() => { if (dbp === opening) dbp = null; });
  }
  return dbp;
}

// iOS can drop the IndexedDB connection while the app is in the background, sometimes without
// closing it, and every later save then fails. Open a fresh connection on return, and close the
// old one once whoever still holds it (a sync takes at most a minute) has finished with it.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !dbp) return;
    const old = dbp;
    dbp = null;
    setTimeout(() => { old.then((d) => d.close(), () => {}); }, 60_000);
  });
}

const libraryListeners = new Set<() => void>();
export function subscribeLibraryWrites(listener: () => void) {
  libraryListeners.add(listener);
  return () => { libraryListeners.delete(listener); };
}
const notifyLibrary = () => libraryListeners.forEach((listener) => listener());
export function pendingChange(key: string, change: LibraryChange): PendingChange {
  return { key, token: uid(), change };
}

export const docs = {
  async all(): Promise<DocRecord[]> {
    const d = await db();
    const list = await d.getAllFromIndex("docs", "updatedAt");
    return list.reverse();
  },
  get: async (id: string) => (await db()).get("docs", id),
  async put(rec: DocRecord) {
    const d = await db();
    const tx = d.transaction(["docs", "outbox"], "readwrite");
    const record = { ...rec, updatedAt: Math.max(Date.now(), rec.updatedAt) };
    // Cache and outbox commit together, including offline writes.
    await tx.objectStore("docs").put(record);
    await tx.objectStore("outbox").put(pendingChange(`doc:${rec.id}`, { kind: "doc", record }));
    await tx.done;
    notifyLibrary();
    return rec.id;
  },
  async delete(id: string) {
    const d = await db();
    const tx = d.transaction(["docs", "positions", "outbox"], "readwrite");
    await tx.objectStore("docs").delete(id);
    await tx.objectStore("positions").delete(id);
    await tx.objectStore("outbox").delete(`position:${id}`);
    await tx.objectStore("outbox").put(pendingChange(`doc:${id}`, { kind: "delete", docId: id }));
    await tx.done;
    notifyLibrary();
  },
};

export const positions = {
  get: async (docId: string) => (await db()).get("positions", docId),
  all: async () => (await db()).getAll("positions"),
  /** Save a listening position. `completed` counts one more full reading; the count otherwise carries over. */
  async put(rec: PositionRecord, opts: { completed?: boolean } = {}) {
    const d = await db();
    const tx = d.transaction(["docs", "positions", "outbox"], "readwrite");
    if (await tx.objectStore("docs").get(rec.docId)) {
      const previous = await tx.objectStore("positions").get(rec.docId);
      const reads = (rec.reads ?? readsOf(previous)) + (opts.completed ? 1 : 0);
      const record: PositionRecord = reads > 0 ? { ...rec, reads } : rec;
      await tx.objectStore("positions").put(record);
      await tx.objectStore("outbox").put(pendingChange(`position:${rec.docId}`, { kind: "position", record }));
    }
    await tx.done;
    notifyLibrary();
    return rec.docId;
  },
};

const AUDIO_CACHE_MAX = 2000;
const audioListeners = new Set<() => void>();
const notifyAudio = () => audioListeners.forEach((listener) => listener());

export const audioCache = {
  get: async (key: string) => (await db()).get("audio", key),
  /** Read coverage without loading audio blobs into memory. */
  keys: async () => (await db()).getAllKeys("audio"),
  subscribe(listener: () => void) {
    audioListeners.add(listener);
    return () => { audioListeners.delete(listener); };
  },
  async put(rec: AudioRecord) {
    const d = await db();
    await d.put("audio", rec);
    // Evict oldest beyond cap (cheap, occasional)
    if (Math.random() < 0.02) {
      const n = await d.count("audio");
      if (n > AUDIO_CACHE_MAX) {
        let cur = await d.transaction("audio", "readwrite").store.index("createdAt").openCursor();
        let toDelete = n - AUDIO_CACHE_MAX;
        while (cur && toDelete-- > 0) {
          await cur.delete();
          cur = await cur.continue();
        }
      }
    }
    notifyAudio();
  },
  async clear() {
    await (await db()).clear("audio");
    notifyAudio();
  },
};
