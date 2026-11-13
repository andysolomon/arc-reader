import type { DocRecord, PositionRecord } from "./db";

/** A position this far through counts as finished; reopening it starts over. */
export const FINISHED_FRACTION = 0.995;

/** Completed readings, counting a finish saved before read counts existed as one. */
export function readsOf(pos: Pick<PositionRecord, "fraction" | "reads"> | undefined): number {
  if (!pos) return 0;
  return pos.reads ?? (pos.fraction >= FINISHED_FRACTION ? 1 : 0);
}

/** Read counts only grow: keep the highest count whichever position wins. */
export function mergeReads<T extends PositionRecord>(winner: T, other: PositionRecord | undefined): T {
  const reads = Math.max(readsOf(winner), readsOf(other));
  return reads > 0 ? { ...winner, reads } : winner;
}

export type LibraryChange =
  | { kind: "doc"; record: DocRecord }
  | { kind: "position"; record: PositionRecord }
  | { kind: "delete"; docId: string };

export interface LibrarySnapshot {
  docs: DocRecord[];
  positions: PositionRecord[];
  /** Permanent tombstones prevent offline clients from restoring deleted documents. */
  deleted: string[];
}

/** A sync answer that names each document's version instead of carrying its body. */
export interface LibraryManifest {
  docs: { id: string; updatedAt: number }[];
  positions: PositionRecord[];
  deleted: string[];
}

export interface LibraryDocs {
  docs: DocRecord[];
  /** Requested documents the server does not hold, such as one deleted meanwhile. */
  missing: string[];
}

export interface PendingChange {
  key: string;
  token: string;
  change: LibraryChange;
}
