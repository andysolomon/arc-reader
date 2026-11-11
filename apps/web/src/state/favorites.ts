import { create } from "zustand";
import { docs, type DocRecord } from "../lib/db";
import { prepareCodeSummaries } from "../lib/codeSummaries";
import { prepareVisualDescriptions } from "../lib/visualDescriptions";
import { hasExplainableBlocks } from "../lib/premiumEstimate";
import { assessPremiumFit, hasPremiumFit } from "../lib/premiumFit";
import { updateDocument } from "./documents";
import { useLibrary } from "./library";
import { useJev, useLlm } from "./llm";
import { useSettings } from "./settings";

interface FavoritesState {
  /** Document ids being assessed, with what is happening */
  assessing: Record<string, string>;
  errors: Record<string, string>;
  /** Favorite or unfavorite. A new favorite is assessed in the background. */
  toggle: (rec: DocRecord) => Promise<void>;
  /**
   * Make the premium estimate exact and ask Jev whether the document deserves a paid voice.
   * OpenCode Go writes the code and image explanations playback would speak (saved, so they are not paid for again),
   * then Jev judges the writing. `quiet` skips a verdict Jev already gave for this text.
   */
  assess: (rec: DocRecord, opts?: { quiet?: boolean }) => Promise<void>;
}

const without = <T,>(map: Record<string, T>, id: string) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== id)) as Record<string, T>;
const configured = async (store: typeof useJev) => {
  if (!store.getState().config) await store.getState().load();
  return !!store.getState().config?.configured;
};

export const useFavorites = create<FavoritesState>()((set, get) => ({
  assessing: {},
  errors: {},
  async toggle(rec) {
    const next = await useLibrary.getState().update(rec.id, { favoritedAt: rec.favoritedAt ? undefined : Date.now() });
    if (next?.favoritedAt) void get().assess(next, { quiet: true });
  },
  async assess(rec, { quiet = false } = {}) {
    if (get().assessing[rec.id]) return;
    const progress = (message: string) => set((s) => ({ assessing: { ...s.assessing, [rec.id]: message } }));
    progress("Assessing…");
    set((s) => ({ errors: without(s.errors, rec.id) }));
    try {
      let latest: DocRecord | undefined = rec;
      if (hasExplainableBlocks(rec) && await configured(useLlm)) {
        const signal = AbortSignal.timeout(180_000);
        let explained = await prepareCodeSummaries(rec, rec.text, useSettings.getState().summaryModel, signal, progress);
        explained = await prepareVisualDescriptions(explained, rec.text, signal, progress);
        if (explained !== rec) {
          latest = await docs.get(rec.id);
          if (latest && latest.text === rec.text) {
            latest = { ...latest, codeSummaries: { ...latest.codeSummaries, ...explained.codeSummaries }, visualDescriptions: { ...latest.visualDescriptions, ...explained.visualDescriptions } };
            await docs.put(latest);
            void useLibrary.getState().refresh();
          }
        }
      }
      if (latest && !(quiet && hasPremiumFit(latest)) && await configured(useJev)) {
        progress("Jev is reading…");
        const premium = await assessPremiumFit(latest);
        const current = await docs.get(rec.id);
        if (current && current.text === latest.text) await useLibrary.getState().update(rec.id, { premium });
      }
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [rec.id]: error instanceof Error ? error.message : "Assessing failed. Please retry." } }));
    } finally {
      set((s) => ({ assessing: without(s.assessing, rec.id) }));
    }
  },
}));
