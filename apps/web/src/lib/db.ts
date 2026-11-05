import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type DocSource = "paste" | "url" | "file" | "share" | "sample";

export interface DocRecord {
  id: string;
  title: string;
  text: string;
  /** Cached adaptation; the original text remains intact. */
  patois?: { sourceText: string; text: string; version: number };
  source: DocSource;
  /** Hostname for URLs, file name for uploads, "Pasted text" otherwise */
  domain: string;
  /** Per-document voice override */
  voice: string | null;
  chars: number;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRecord {
  docId: string;
  variant?: "original" | "patois";
  index: number;
  /** seconds into the sentence at 1× */
  offset: number;
  /** 0..1 */
  fraction: number;
  /** total duration estimate at 1× */
  total: number;
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
  createdAt: number;
}

interface Schema extends DBSchema {
  docs: { key: string; value: DocRecord; indexes: { updatedAt: number } };
  positions: { key: string; value: PositionRecord };
  audio: { key: string; value: AudioRecord; indexes: { createdAt: number } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>("readaloud", 1, {
      upgrade(d) {
        const docs = d.createObjectStore("docs", { keyPath: "id" });
        docs.createIndex("updatedAt", "updatedAt");
        d.createObjectStore("positions", { keyPath: "docId" });
        const audio = d.createObjectStore("audio", { keyPath: "key" });
        audio.createIndex("createdAt", "createdAt");
      },
    });
  }
  return dbp;
}

export const docs = {
  async all(): Promise<DocRecord[]> {
    const d = await db();
    const list = await d.getAllFromIndex("docs", "updatedAt");
    return list.reverse();
  },
  get: async (id: string) => (await db()).get("docs", id),
  put: async (rec: DocRecord) => (await db()).put("docs", rec),
  async delete(id: string) {
    const d = await db();
    await Promise.all([d.delete("docs", id), d.delete("positions", id)]);
  },
};

export const positions = {
  get: async (docId: string) => (await db()).get("positions", docId),
  all: async () => (await db()).getAll("positions"),
  put: async (rec: PositionRecord) => (await db()).put("positions", rec),
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
