import { create } from "zustand";
import { audioCache, docs as docStore, positions, type DocMeta, type DocRecord, type DocSource } from "../lib/db";
import { estimateTotal, titleFrom } from "../lib/segment";
import { uid } from "../lib/hash";
import { preparedVoices, type PreparedVoice } from "../lib/prepared";
import { useVoices } from "./voices";
import { useSettings } from "./settings";
import { usePreparation } from "./preparation";
import { serverPreparedKeys } from "../engine/preparation";
import { voiceIdOfKeyPart } from "../engine/voiceRevisions";
import { readsOf } from "../lib/libraryProtocol";
import { linksInMarkdown, uniqueLinks, type DocLink } from "../lib/links";
import { updateDocument, type DocPatch } from "./documents";
import { useCategories } from "./categories";

export interface LibraryItem {
  rec: DocRecord;
  /** 0..1 */
  progress: number;
  /** total seconds at 1× */
  duration: number;
  /** Complete readings so far */
  reads: number;
  prepared: PreparedVoice[];
}

interface LibraryState {
  items: LibraryItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (input: { text: string; title?: string; source: DocSource; domain?: string; voice?: string | null; meta?: DocMeta; links?: DocLink[] }) => Promise<DocRecord>;
  /** Edit catalogue fields: title, metadata, category. */
  update: (id: string, patch: DocPatch) => Promise<DocRecord | undefined>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

let refreshVersion = 0;
export const useLibrary = create<LibraryState>()((set, get) => ({
  items: [],
  loaded: false,
  async refresh() {
    const version = ++refreshVersion;
    try {
      const [all, pos, keys] = await Promise.all([docStore.all(), positions.all(), audioCache.keys()]);
      if (version !== refreshVersion) return;
      const byId = new Map(pos.map((p) => [p.docId, p]));
      const allKeys = [...keys, ...serverPreparedKeys()];
      const cached = new Set(allKeys);
      const voices = [...useVoices.getState().voices];
      // Saved voices can outlive a catalogue page or an unavailable speech server.
      for (const key of allKeys) {
        const [engine, part] = key.split("|");
        const id = part && voiceIdOfKeyPart(part);
        if (id && !voices.some((v) => v.id === id)) voices.push({ id, name: id, engine: engine.split(":")[0], kind: "preset", lang: "", hue: null, tags: [] });
      }
      set({
        items: all.map((rec) => {
          const p = byId.get(rec.id);
          return { rec, progress: p ? Math.min(1, p.fraction) : 0, duration: p?.total || estimateTotal(rec.text), reads: readsOf(p), prepared: preparedVoices(rec, voices, cached, useSettings.getState().openaiModel) };
        }),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  async create({ text, title, source, domain, voice = null, meta, links = [] }) {
    const now = Date.now();
    // Page links come from the HTML; links written into the text itself count too.
    const allLinks = uniqueLinks([...links, ...linksInMarkdown(text)]);
    const rec: DocRecord = {
      id: uid(),
      title: title?.trim() || titleFrom(text),
      text,
      source,
      domain: domain ?? (source === "paste" ? "Pasted text" : source === "sample" ? "Sample" : source === "share" ? "Shared" : "Text"),
      voice,
      ...(meta && Object.keys(meta).length ? { meta } : {}),
      chars: text.length,
      ...(allLinks.length ? { links: allLinks } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await docStore.put(rec);
    void get().refresh();
    // Shelve new documents in the background when Jev is set up; you can change it later.
    void useCategories.getState().suggest(rec, { quiet: true });
    return rec;
  },
  async update(id, patch) {
    const next = await updateDocument(id, patch);
    void get().refresh();
    return next;
  },
  async remove(id) {
    usePreparation.getState().cancelDocument(id);
    await docStore.delete(id);
    refreshVersion++;
    set({ items: get().items.filter((i) => i.rec.id !== id) });
  },
  async touch(id) {
    const rec = await docStore.get(id);
    if (rec) await docStore.put({ ...rec, updatedAt: Date.now() });
    void get().refresh();
  },
}));
