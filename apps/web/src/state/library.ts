import { create } from "zustand";
import { docs as docStore, positions, type DocRecord, type DocSource } from "../lib/db";
import { estimateTotal, titleFrom } from "../lib/segment";
import { uid } from "../lib/hash";

export interface LibraryItem {
  rec: DocRecord;
  /** 0..1 */
  progress: number;
  /** total seconds at 1× */
  duration: number;
}

interface LibraryState {
  items: LibraryItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (input: { text: string; title?: string; source: DocSource; domain?: string; voice?: string | null }) => Promise<DocRecord>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  items: [],
  loaded: false,
  async refresh() {
    try {
      const [all, pos] = await Promise.all([docStore.all(), positions.all()]);
      const byId = new Map(pos.map((p) => [p.docId, p]));
      set({
        items: all.map((rec) => {
          const p = byId.get(rec.id);
          return { rec, progress: p ? Math.min(1, p.fraction) : 0, duration: p?.total || estimateTotal(rec.text) };
        }),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  async create({ text, title, source, domain, voice = null }) {
    const now = Date.now();
    const rec: DocRecord = {
      id: uid(),
      title: title?.trim() || titleFrom(text),
      text,
      source,
      domain: domain ?? (source === "paste" ? "Pasted text" : source === "sample" ? "Sample" : source === "share" ? "Shared" : "Text"),
      voice,
      chars: text.length,
      createdAt: now,
      updatedAt: now,
    };
    await docStore.put(rec);
    void get().refresh();
    return rec;
  },
  async remove(id) {
    await docStore.delete(id);
    set({ items: get().items.filter((i) => i.rec.id !== id) });
  },
  async touch(id) {
    const rec = await docStore.get(id);
    if (rec) await docStore.put({ ...rec, updatedAt: Date.now() });
    void get().refresh();
  },
}));
