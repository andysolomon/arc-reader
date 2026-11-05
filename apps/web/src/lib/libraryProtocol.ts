import type { DocRecord, PositionRecord } from "./db";

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

export interface PendingChange {
  key: string;
  token: string;
  change: LibraryChange;
}
