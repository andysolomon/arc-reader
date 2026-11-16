import { create } from "zustand";
import { docs, type DocRecord } from "../lib/db";
import { drawDiagram } from "../lib/articleDiagram";
import { useSettings } from "./settings";
import { usePlayer } from "./player";

interface DiagramsState {
  /** Document ids with a diagram request in flight */
  pending: Record<string, boolean>;
  errors: Record<string, string>;
  /** Draw with the summary model and save it on the document (shared through library sync). */
  request: (rec: DocRecord, opts?: { force?: boolean }) => Promise<void>;
  /** Forget the document's diagram, on this device and through sync. */
  remove: (rec: DocRecord) => Promise<void>;
}

const without = <T,>(map: Record<string, T>, id: string) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== id)) as Record<string, T>;

/** Saves onto the newest copy so a voice change or sync during the request is kept. */
async function save(id: string, change: (latest: DocRecord) => DocRecord) {
  const latest = await docs.get(id);
  if (!latest) return;
  const next = { ...change(latest), updatedAt: Date.now() };
  await docs.put(next);
  const player = usePlayer.getState();
  if (player.record?.id === id) usePlayer.setState({ record: { ...player.record, diagram: next.diagram } });
}

export const useDiagrams = create<DiagramsState>()((set, get) => ({
  pending: {},
  errors: {},
  async request(rec, opts) {
    if (get().pending[rec.id]) return;
    set((s) => ({ pending: { ...s.pending, [rec.id]: true }, errors: without(s.errors, rec.id) }));
    try {
      const diagram = await drawDiagram(rec, useSettings.getState().summaryModel, opts);
      await save(rec.id, (latest) => {
        if (latest.text !== rec.text) throw new Error("The text changed while the diagram was being drawn. Please retry.");
        return { ...latest, diagram };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Drawing the diagram failed. Please retry.";
      set((s) => ({ errors: { ...s.errors, [rec.id]: message } }));
    } finally {
      set((s) => ({ pending: without(s.pending, rec.id) }));
    }
  },
  async remove(rec) {
    set((s) => ({ errors: without(s.errors, rec.id) }));
    await save(rec.id, ({ diagram: _, ...latest }) => latest);
  },
}));
