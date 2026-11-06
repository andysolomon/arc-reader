import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { DocRecord, PositionRecord } from "./src/lib/db";
import { mergeReads, type LibraryChange, type LibrarySnapshot } from "./src/lib/libraryProtocol";

const MAX_BODY = 16 * 1024 * 1024;
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function validDoc(value: unknown): value is DocRecord {
  if (!object(value)) return false;
  return id(value.id) && typeof value.title === "string" && value.title.length <= 10000
    && typeof value.text === "string" && value.text.length <= 5_000_000
    && ["paste", "url", "file", "share", "sample"].includes(value.source as string)
    && typeof value.domain === "string" && value.domain.length <= 10000
    && (value.voice === null || id(value.voice)) && number(value.chars)
    && number(value.createdAt) && number(value.updatedAt)
    && (value.patois === undefined || (object(value.patois) && typeof value.patois.sourceText === "string"
      && value.patois.sourceText.length <= 5_000_000 && typeof value.patois.text === "string"
      && value.patois.text.length <= 5_000_000 && number(value.patois.version)))
    && (value.visualDescriptions === undefined || (object(value.visualDescriptions)
      && Object.keys(value.visualDescriptions).length <= 2000
      && Object.entries(value.visualDescriptions).every(([key, text]) => key.length <= 100 && typeof text === "string" && text.length <= 1000)))
    && (value.codeSummaries === undefined || (object(value.codeSummaries)
      && Object.keys(value.codeSummaries).length <= 2000
      && Object.entries(value.codeSummaries).every(([key, text]) => key.length <= 100 && typeof text === "string" && text.length <= 700)))
    && (value.summary === undefined || (object(value.summary) && typeof value.summary.source === "string"
      && value.summary.source.length <= 100 && typeof value.summary.text === "string" && value.summary.text.length <= 100_000
      && typeof value.summary.model === "string" && value.summary.model.length <= 200
      && number(value.summary.version) && number(value.summary.createdAt)));
}

function validPosition(value: unknown): value is PositionRecord {
  if (!object(value)) return false;
  return id(value.docId) && number(value.index) && Number.isInteger(value.index)
    && number(value.offset) && number(value.fraction) && value.fraction <= 1 && number(value.total) && number(value.updatedAt)
    && (value.reads === undefined || (number(value.reads) && Number.isInteger(value.reads) && value.reads >= 0))
    && (value.narrationVersion === undefined || number(value.narrationVersion))
    && (value.variant === undefined || value.variant === "original" || value.variant === "patois");
}

function changesFrom(raw: unknown): LibraryChange[] {
  if (!object(raw) || !Array.isArray(raw.changes) || raw.changes.length > 1000) throw new HttpError(400, "Invalid library changes.");
  for (const change of raw.changes) {
    if (!object(change) || !(change.kind === "doc" ? validDoc(change.record)
      : change.kind === "position" ? validPosition(change.record)
      : change.kind === "delete" && id(change.docId))) throw new HttpError(400, "Invalid library change.");
  }
  return raw.changes as LibraryChange[];
}

/** A single server owns the library. Each request is serialized and committed atomically before acknowledgment. */
export class LibraryService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}

  sync(raw: unknown): Promise<LibrarySnapshot> {
    const changes = changesFrom(raw);
    const run = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = resolve(this.directory, "library.json");
      let snapshot: LibrarySnapshot;
      try {
        snapshot = JSON.parse(await readFile(file, "utf8"));
        // Fail closed on damaged storage instead of replacing it with an empty library.
        if (!Array.isArray(snapshot.docs) || !snapshot.docs.every(validDoc)
          || !Array.isArray(snapshot.positions) || !snapshot.positions.every(validPosition)
          || !Array.isArray(snapshot.deleted) || !snapshot.deleted.every(id)) throw new Error("Invalid library storage.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        snapshot = { docs: [], positions: [], deleted: [] };
      }
      const docs = new Map(snapshot.docs.map((doc) => [doc.id, doc]));
      const positions = new Map(snapshot.positions.map((pos) => [pos.docId, pos]));
      const deleted = new Set(snapshot.deleted);
      for (const change of changes) {
        if (change.kind === "delete") {
          deleted.add(change.docId);
          docs.delete(change.docId);
          positions.delete(change.docId);
        } else if (change.kind === "doc") {
          const rec = change.record;
          if (!deleted.has(rec.id) && (!docs.has(rec.id) || rec.updatedAt >= docs.get(rec.id)!.updatedAt)) docs.set(rec.id, rec);
        }
      }
      // Positions may arrive before their document in a batch.
      for (const change of changes) {
        if (change.kind !== "position") continue;
        const rec = change.record;
        if (!docs.has(rec.docId) || deleted.has(rec.docId)) continue;
        const current = positions.get(rec.docId);
        // Older clients omit read counts; never let them erase one.
        positions.set(rec.docId, !current || rec.updatedAt >= current.updatedAt ? mergeReads(rec, current) : mergeReads(current, rec));
      }
      const next = { docs: [...docs.values()], positions: [...positions.values()], deleted: [...deleted] };
      if (changes.length) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, file);
      }
      return next;
    });
    this.queue = run;
    return run;
  }
}

export function libraryMiddleware(service: LibraryService): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    void (async () => {
      if (req.url?.split("?")[0] !== "/sync") return send(404, { error: "Library endpoint not found." });
      if (req.method !== "POST") return send(405, { error: "Use POST to sync the library." });
      // The library is shared by clients allowed to reach this server. Reject cross-site writes.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: "Cross-origin library writes are not allowed." });
      if (!req.headers["content-type"]?.startsWith("application/json")) return send(415, { error: "Expected JSON." });
      const buffers: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        if (length > MAX_BODY) throw new HttpError(413, "Library changes are too large.");
        buffers.push(Buffer.from(chunk));
      }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(buffers).toString("utf8")); }
      catch { throw new HttpError(400, "Invalid JSON."); }
      send(200, await service.sync(raw));
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("Library sync failed:", error);
      send(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "The server could not save the library. Your changes remain on this device." });
    });
  };
}

export function sharedLibrary(env: Record<string, string>): Plugin {
  const service = new LibraryService(resolve(env.LIBRARY_DATA_DIR || ".readaloud-library"));
  const middleware = libraryMiddleware(service);
  return {
    name: "readaloud:shared-library",
    configureServer(server) { server.middlewares.use("/api/library", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/library", middleware); },
  };
}
