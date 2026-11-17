import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { BookContents } from "./src/lib/book";
import { MAX_CHAPTERS } from "./src/lib/book";
import { placeIn, planChapters, type BookImportJob } from "./src/lib/bookImport";
import type { DocMeta, DocRecord } from "./src/lib/db";
import { newDocRecord } from "./src/lib/docRecord";
import { hostOf, readChapterPage, type Fetched } from "./src/lib/fetchUrl";
import { fetchUpstream } from "./vite.fetch";
import type { LibraryService } from "./vite.library";
import type { SlidePictures } from "./vite.pdf";
import { sendJson } from "./vite.json";

/**
 * POST /api/books/import adds a book's missing chapters to the shared library from the server,
 * so they keep arriving while the phone that asked is locked or the app is closed. Each chapter
 * is saved as it comes, and the app's library sync brings it in. GET /api/books/import lists
 * the imports running and lately finished, for the app to show how far each has got.
 */

/** Chapters fetched side by side: quick, without hammering the book's site. */
const AT_ONCE = 3;
/** A finished import is listed this long, so an app that was away still hears how it went. */
const KEEP_FINISHED_MS = 30 * 60_000;
const MAX_BODY = 16 * 1024 * 1024;

export type ReadChapter = (url: string) => Promise<Fetched>;

export class BookImports {
  private jobs = new Map<string, BookImportJob>();
  constructor(private library: LibraryService, private read: ReadChapter, private now = () => Date.now()) {}

  list(): BookImportJob[] {
    for (const [id, job] of this.jobs) if (job.finishedAt && this.now() - job.finishedAt > KEEP_FINISHED_MS) this.jobs.delete(id);
    return [...this.jobs.values()];
  }

  /** Starts adding the book, or answers with the import already adding it. `done` settles when it finishes. */
  start(book: BookContents): { job: BookImportJob; done: Promise<void> } {
    const running = this.jobs.get(book.id);
    if (running && !running.finishedAt) return { job: running, done: Promise.resolve() };
    const job: BookImportJob = { bookId: book.id, title: book.title, ...(book.kind ? { kind: book.kind } : {}), done: 0, total: 0, failed: 0, added: [], startedAt: this.now() };
    this.jobs.set(book.id, job);
    const done = this.run(job, book).catch((error) => {
      console.error("Adding chapters failed:", error);
      job.failed = Math.max(job.failed, job.total - job.added.length);
    }).finally(() => { job.finishedAt = this.now(); });
    return { job, done };
  }

  private async run(job: BookImportJob, book: BookContents) {
    const { moved, missing } = planChapters(book, await this.library.documents());
    job.total = missing.length;
    if (moved.length) await this.library.save(moved.map(({ rec, book: place }) => ({ ...rec, book: place, updatedAt: this.now() })));
    const settled: (string | null | undefined)[] = missing.map(() => undefined);
    const queue = missing.map((chapter, slot) => ({ chapter, slot }));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { chapter, slot } = next;
        const place = placeIn(book, chapter.index);
        let id: string | null = null;
        try {
          let rec: DocRecord;
          if (chapter.loose) rec = { ...chapter.loose, book: place, title: chapter.title, updatedAt: this.now() };
          else if (chapter.text !== undefined) {
            const meta: DocMeta = book.meta ?? { url: chapter.url };
            rec = newDocRecord({ text: chapter.text, title: chapter.title, source: book.file ? "file" : "url", domain: book.file ?? hostOf(chapter.url), meta, book: place }, this.now());
          } else {
            const page = await this.read(chapter.url);
            rec = newDocRecord({ text: page.text, title: chapter.title, source: "url", domain: page.domain, meta: page.meta, links: page.links, book: place }, this.now());
          }
          await this.library.save([rec]);
          id = rec.id;
        } catch { /* Counted below; the rest of the book still arrives. */ }
        settled[slot] = id;
        if (id) job.added.push(id);
        else job.failed++;
        job.done++;
        // Reading starts at the earliest chapter in, once nothing before it can still arrive.
        if (!job.first) for (const result of settled) {
          if (result === undefined) break;
          if (result) { job.first = result; break; }
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const link = (value: unknown) => typeof value === "string" && value.length <= 4000 && /^https?:\/\//i.test(value);
const string = (value: unknown, max: number) => typeof value === "string" && value.length <= max;

/** The book as the app read it off its pages; the library checks each chapter again as it is saved. */
export function bookFrom(raw: unknown): BookContents {
  const book = object(raw) ? raw.book : undefined;
  if (!object(book) || !string(book.id, 200) || !book.id || !string(book.title, 1000)
    || !Array.isArray(book.chapters) || !book.chapters.length || book.chapters.length > MAX_CHAPTERS
    || !book.chapters.every((chapter) => object(chapter) && string(chapter.url, 4000) && string(chapter.title, 1000)
      && (chapter.text === undefined ? link(chapter.url) : string(chapter.text, 5_000_000)))
    || (book.kind !== undefined && book.kind !== "course")
    || (book.contents !== undefined && !link(book.contents))
    || (book.file !== undefined && !string(book.file, 1000))
    || (book.meta !== undefined && !object(book.meta))) throw new HttpError(400, "Invalid book.");
  const { id, title, chapters, kind, contents, meta, file } = book as unknown as BookContents;
  return {
    id, title, index: null,
    chapters: chapters.map(({ url, title: name, text }) => ({ url, title: name, ...(text !== undefined ? { text } : {}) })),
    ...(kind ? { kind } : {}), ...(contents ? { contents } : {}), ...(meta ? { meta } : {}), ...(file ? { file } : {}),
  };
}

let dom: Promise<void> | undefined;
/** The page reader parses HTML the way a browser does; on the server jsdom stands in. */
function withDom(): Promise<void> {
  dom ??= (async () => {
    if (typeof DOMParser !== "undefined") return;
    const { JSDOM } = await import("jsdom");
    const { window } = new JSDOM("");
    Object.assign(globalThis, { DOMParser: window.DOMParser, Node: window.Node, Element: window.Element, XMLSerializer: window.XMLSerializer });
  })();
  return dom;
}

/** A chapter read off its page by the server, the way the app reads one. */
export const readOnServer = (pictures?: SlidePictures): ReadChapter => async (url) => {
  await withDom();
  const { status, type, body } = await fetchUpstream(new URL(url), pictures);
  return readChapterPage(new Response(body, { status, headers: { "content-type": type } }), url);
};

export function bookImportMiddleware(imports: BookImports): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => sendJson(req, res, status, body);
    void (async () => {
      if ((req.url?.split("?")[0] ?? "") !== "/import") return send(404, { error: "Not found." });
      if (req.method === "GET") return send(200, { jobs: imports.list() });
      if (req.method !== "POST") return send(405, { error: "Use GET or POST." });
      // Imports write to the shared library: reject cross-site requests, as library writes do.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: "Cross-origin imports are not allowed." });
      if (!req.headers["content-type"]?.startsWith("application/json")) return send(415, { error: "Expected JSON." });
      const buffers: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += Buffer.byteLength(chunk);
        if (length > MAX_BODY) throw new HttpError(413, "The book is too large.");
        buffers.push(Buffer.from(chunk));
      }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(buffers).toString("utf8")); }
      catch { throw new HttpError(400, "Invalid JSON."); }
      send(200, { job: imports.start(bookFrom(raw)).job });
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("Book import failed:", error);
      send(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "The server could not add the chapters." });
    });
  };
}

export function bookImport(library: LibraryService, pictures?: SlidePictures): Plugin {
  const middleware = bookImportMiddleware(new BookImports(library, readOnServer(pictures)));
  return {
    name: "readaloud:book-import",
    configureServer(server) { server.middlewares.use("/api/books", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/books", middleware); },
  };
}
