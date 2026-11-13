import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { DocRecord, PositionRecord } from "./src/lib/db";
import { MAX_LINK_TEXT, MAX_LINK_URL, MAX_LINKS } from "./src/lib/links";
import { mergeReads, type LibraryChange, type LibraryDocs, type LibraryManifest, type LibrarySnapshot } from "./src/lib/libraryProtocol";
import { sendJson } from "./vite.json";

const MAX_BODY = 16 * 1024 * 1024;
/** Document bodies per /docs answer, as JSON characters. A larger document still goes, alone. */
const DOCS_BUDGET = 1_000_000;
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = (value: unknown, max: number) => value === undefined || (typeof value === "string" && value.length <= max);
const META_LIMITS = { url: 4000, author: 1000, published: 100, site: 1000, description: 10_000, notes: 200_000 };
const validMeta = (value: unknown) => value === undefined || (object(value)
  && Object.entries(value).every(([key, field]) => Object.hasOwn(META_LIMITS, key) && text(field, META_LIMITS[key as keyof typeof META_LIMITS])));
const validCategory = (value: unknown) => value === undefined || (object(value)
  && typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 200
  && (value.by === "jev" || value.by === "you") && number(value.at)
  && (value.confidence === undefined || (number(value.confidence) && value.confidence <= 1)) && text(value.model, 200));

const validBook = (value: unknown) => value === undefined || (object(value) && id(value.id)
  && typeof value.title === "string" && value.title.length <= 1000
  && [value.chapter, value.chapters].every((n) => number(n) && Number.isInteger(n) && n >= 1 && n <= 10_000)
  && (value.kind === undefined || value.kind === "course")
  && (value.contents === undefined || (typeof value.contents === "string" && value.contents.length <= 4000 && /^https?:\/\//i.test(value.contents))));

const validPremium = (value: unknown) => value === undefined || (object(value)
  && ["strong", "good", "weak"].includes(value.fit as string) && number(value.at)
  && typeof value.source === "string" && value.source.length <= 100
  && (value.confidence === undefined || (number(value.confidence) && value.confidence <= 1)) && text(value.model, 200));

const validLinks = (value: unknown) => Array.isArray(value) && value.length <= MAX_LINKS
  && value.every((link) => object(link) && typeof link.url === "string" && /^https?:\/\//i.test(link.url)
    && link.url.length <= MAX_LINK_URL && typeof link.text === "string" && link.text.length <= MAX_LINK_TEXT);

function validDoc(value: unknown): value is DocRecord {
  if (!object(value)) return false;
  return id(value.id) && typeof value.title === "string" && value.title.length <= 10000
    && typeof value.text === "string" && value.text.length <= 5_000_000
    && ["paste", "url", "file", "share", "sample"].includes(value.source as string)
    && typeof value.domain === "string" && value.domain.length <= 10000
    && (value.voice === null || id(value.voice)) && number(value.chars)
    && (value.links === undefined || validLinks(value.links))
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
      && number(value.summary.version) && number(value.summary.createdAt)))
    && (value.favoritedAt === undefined || number(value.favoritedAt))
    && validMeta(value.meta) && validBook(value.book) && validCategory(value.category) && validPremium(value.premium);
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
  /** The parsed library, kept while the file on disk is the one it was read from. */
  private cache?: { mtimeMs: number; size: number; snapshot: LibrarySnapshot };
  constructor(private directory: string) {}

  /** Routes a request body the way the HTTP endpoint does. */
  request(path: string, raw: unknown): Promise<LibrarySnapshot | LibraryManifest | LibraryDocs> {
    if (path === "/docs") return this.docs(raw);
    if (path === "/sync") return object(raw) && raw.view === "manifest" ? this.manifest(raw) : this.sync(raw);
    return Promise.reject(new HttpError(404, "Library endpoint not found."));
  }

  /** Commits the changes and answers with the whole library. Older clients use this. */
  sync(raw: unknown): Promise<LibrarySnapshot> {
    return this.commit(changesFrom(raw));
  }

  /** Commits the changes and answers with every document's version instead of its body. */
  async manifest(raw: unknown): Promise<LibraryManifest> {
    const snapshot = await this.commit(changesFrom(raw));
    return { docs: snapshot.docs.map((doc) => ({ id: doc.id, updatedAt: doc.updatedAt })), positions: snapshot.positions, deleted: snapshot.deleted };
  }

  /** The requested documents, as many as fit one answer; ask again for the rest. */
  async docs(raw: unknown): Promise<LibraryDocs> {
    if (!object(raw) || !Array.isArray(raw.ids) || raw.ids.length > 1000 || !raw.ids.every(id)) throw new HttpError(400, "Invalid document request.");
    const ids = [...new Set(raw.ids as string[])];
    return this.serialized(async () => {
      const stored = new Map((await this.load()).docs.map((doc) => [doc.id, doc]));
      const docs: DocRecord[] = [];
      const missing: string[] = [];
      let size = 0;
      for (const wanted of ids) {
        const record = stored.get(wanted);
        if (!record) { missing.push(wanted); continue; }
        const length = JSON.stringify(record).length;
        if (docs.length && size + length > DOCS_BUDGET) continue;
        docs.push(record);
        size += length;
      }
      return { docs, missing };
    });
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => {}).then(task);
    this.queue = run;
    return run;
  }

  private get file() { return resolve(this.directory, "library.json"); }

  private async load(): Promise<LibrarySnapshot> {
    let info: Awaited<ReturnType<typeof stat>>;
    try { info = await stat(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { docs: [], positions: [], deleted: [] };
    }
    // Phones poll every few seconds; parse and check the file only when it changes.
    if (this.cache && this.cache.mtimeMs === info.mtimeMs && this.cache.size === info.size) return this.cache.snapshot;
    const snapshot = JSON.parse(await readFile(this.file, "utf8")) as LibrarySnapshot;
    // Fail closed on damaged storage instead of replacing it with an empty library.
    if (!Array.isArray(snapshot.docs) || !snapshot.docs.every(validDoc)
      || !Array.isArray(snapshot.positions) || !snapshot.positions.every(validPosition)
      || !Array.isArray(snapshot.deleted) || !snapshot.deleted.every(id)) throw new Error("Invalid library storage.");
    this.cache = { mtimeMs: info.mtimeMs, size: info.size, snapshot };
    return snapshot;
  }

  private commit(changes: LibraryChange[]): Promise<LibrarySnapshot> {
    return this.serialized(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const snapshot = await this.load();
      if (!changes.length) return snapshot;
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
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.file);
      const info = await stat(this.file);
      this.cache = { mtimeMs: info.mtimeMs, size: info.size, snapshot: next };
      return next;
    });
  }
}

export function libraryMiddleware(service: LibraryService): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => sendJson(req, res, status, body);
    const path = req.url?.split("?")[0] ?? "";
    void (async () => {
      if (path !== "/sync" && path !== "/docs") return send(404, { error: "Library endpoint not found." });
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
      send(200, await service.request(path, raw));
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
