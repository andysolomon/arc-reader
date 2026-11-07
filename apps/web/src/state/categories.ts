import { create } from "zustand";
import { docs, type DocRecord } from "../lib/db";
import { suggestCategory } from "../lib/category";
import { updateDocument } from "./documents";
import { useJev } from "./llm";

interface CategoriesState {
  /** Document ids with a Jev request in flight */
  pending: Record<string, boolean>;
  errors: Record<string, string>;
  /**
   * Ask Jev to shelve a document and save its pick (shared through library sync).
   * `quiet` is background filing: only when Jev is set up, never over a category already chosen, failures unreported.
   */
  suggest: (rec: DocRecord, opts?: { quiet?: boolean }) => Promise<boolean>;
  /** Shelve several documents a few at a time. Resolves with how many were filed. */
  suggestAll: (recs: DocRecord[]) => Promise<number>;
  /** Your own category, or null to clear it. */
  choose: (id: string, name: string | null) => Promise<void>;
}

const without = (map: Record<string, unknown>, id: string) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== id));
const usedNames = async () => (await docs.all()).flatMap((rec) => (rec.category ? [rec.category.name] : []));

export const useCategories = create<CategoriesState>()((set, get) => ({
  pending: {},
  errors: {},
  async suggest(rec, { quiet = false } = {}) {
    if (get().pending[rec.id]) return false;
    if (quiet) {
      if (rec.category) return false;
      if (!useJev.getState().config) await useJev.getState().load();
      if (!useJev.getState().config?.configured) return false;
    }
    set((s) => ({ pending: { ...s.pending, [rec.id]: true }, errors: without(s.errors, rec.id) as Record<string, string> }));
    try {
      const category = await suggestCategory(rec, await usedNames());
      const latest = await docs.get(rec.id);
      if (!latest || (quiet && latest.category)) return false;
      await updateDocument(rec.id, { category });
      return true;
    } catch (error) {
      if (!quiet) set((s) => ({ errors: { ...s.errors, [rec.id]: error instanceof Error ? error.message : "Categorizing failed. Please retry." } }));
      return false;
    } finally {
      set((s) => ({ pending: without(s.pending, rec.id) as Record<string, boolean> }));
    }
  },
  async suggestAll(recs) {
    const queue = [...recs];
    let filed = 0;
    const worker = async () => {
      for (let rec = queue.shift(); rec; rec = queue.shift()) if (await get().suggest(rec)) filed++;
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return filed;
  },
  async choose(id, name) {
    const trimmed = name?.trim();
    set((s) => ({ errors: without(s.errors, id) as Record<string, string> }));
    await updateDocument(id, { category: trimmed ? { name: trimmed.slice(0, 200), by: "you", at: Date.now() } : undefined });
  },
}));
