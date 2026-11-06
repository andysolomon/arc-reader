import { docs, type DocRecord } from "../lib/db";
import { usePlayer } from "./player";

export type DocPatch = Partial<Pick<DocRecord, "title" | "meta" | "category">>;

/** Change catalogue fields on the newest saved copy, so a sync or voice change in the meantime is kept. */
export async function updateDocument(id: string, patch: DocPatch): Promise<DocRecord | undefined> {
  const latest = await docs.get(id);
  if (!latest) return undefined;
  const next: DocRecord = { ...latest, ...patch, updatedAt: Date.now() };
  for (const key of ["meta", "category"] as const) if (key in patch && !patch[key]) delete next[key];
  await docs.put(next);
  const player = usePlayer.getState();
  if (player.record?.id === id) {
    usePlayer.setState({
      record: { ...player.record, title: next.title, meta: next.meta, category: next.category },
      // A new doc object restarts playback work, so replace it only for a new title.
      doc: player.doc?.id === id && player.doc.title !== next.title ? { ...player.doc, title: next.title } : player.doc,
    });
  }
  return next;
}
