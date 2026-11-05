import { create } from "zustand";
import { docs, type DocRecord } from "../lib/db";
import { summarize } from "../lib/summary";
import { useSettings } from "./settings";
import { usePlayer } from "./player";

interface SummariesState {
  /** Document ids with a summary request in flight */
  pending: Record<string, boolean>;
  errors: Record<string, string>;
  /** Summarize with the chosen model and save it on the document (shared through library sync). */
  request: (rec: DocRecord) => Promise<void>;
}

const without = (map: Record<string, unknown>, id: string) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== id));

export const useSummaries = create<SummariesState>()((set, get) => ({
  pending: {},
  errors: {},
  async request(rec) {
    if (get().pending[rec.id]) return;
    set((s) => ({ pending: { ...s.pending, [rec.id]: true }, errors: without(s.errors, rec.id) as Record<string, string> }));
    try {
      const summary = await summarize(rec, useSettings.getState().summaryModel);
      // Merge into the newest copy so a voice change or sync during the request is kept.
      const latest = await docs.get(rec.id);
      if (!latest) return;
      if (latest.text !== rec.text) throw new Error("The text changed while it was being summarized. Please retry.");
      const next = { ...latest, summary, updatedAt: Date.now() };
      await docs.put(next);
      const player = usePlayer.getState();
      if (player.record?.id === rec.id) usePlayer.setState({ record: { ...player.record, summary } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Summarizing failed. Please retry.";
      set((s) => ({ errors: { ...s.errors, [rec.id]: message } }));
    } finally {
      set((s) => ({ pending: without(s.pending, rec.id) as Record<string, boolean> }));
    }
  },
}));
