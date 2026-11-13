import { create } from "zustand";
import { audioCache, docs as docStore, positions, type DocBook, type DocMeta, type DocRecord, type DocSource } from "../lib/db";
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
import { catalogue } from "../lib/postTitle";

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

/** Everything a researcher might remember a document by, lower-cased for matching. */
export const searchable = ({ rec }: LibraryItem) => [rec.title, rec.domain, rec.book?.title, rec.category?.name, ...Object.values(rec.meta ?? {})].join("\n").toLowerCase();

interface LibraryState {
  items: LibraryItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** `batch` is one of many added together: the caller refreshes the library and files them once they are all in. */
  create: (input: { text: string; title?: string; source: DocSource; domain?: string; voice?: string | null; meta?: DocMeta; links?: DocLink[]; book?: DocBook; batch?: boolean }) => Promise<DocRecord>;
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
        items: all
          .map((rec) => {
            const p = byId.get(rec.id);
            return { rec, progress: p ? Math.min(1, p.fraction) : 0, duration: p?.total || estimateTotal(rec.text), reads: readsOf(p), prepared: preparedVoices(rec, voices, cached, useSettings.getState().openaiModel) };
          })
          // Newest first by when the document was added: filing, editing or opening it doesn't move it.
          .sort((a, b) => b.rec.createdAt - a.rec.createdAt),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  async create({ text, title, source, domain, voice = null, meta, links = [], book, batch = false }) {
    const now = Date.now();
    // Page links come from the HTML; links written into the text itself count too.
    const allLinks = uniqueLinks([...links, ...linksInMarkdown(text)]);
    // X's page title carries the author and site; keep them in their own fields instead.
    const named = title?.trim() ? catalogue({ title, domain, meta }) : null;
    if (named?.author && !meta?.author) meta = { ...meta, author: named.author };
    const rec: DocRecord = {
      id: uid(),
      title: named?.title || titleFrom(text),
      text,
      source,
      domain: domain ?? (source === "paste" ? "Pasted text" : source === "sample" ? "Sample" : source === "share" ? "Shared" : "Text"),
      voice,
      ...(meta && Object.keys(meta).length ? { meta } : {}),
      ...(book ? { book } : {}),
      chars: text.length,
      ...(allLinks.length ? { links: allLinks } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await docStore.put(rec);
    if (batch) return rec;
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
