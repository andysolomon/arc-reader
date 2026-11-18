import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BookImports, bookFrom, bookImportMiddleware, readOnServer, type ReadChapter } from "./vite.books";
import { LibraryService } from "./vite.library";
import type { BookContents } from "./src/lib/book";
import type { DocRecord } from "./src/lib/db";

const SITE = "https://book.example";
const book = (slugs: string[], extra: Partial<BookContents> = {}): BookContents => ({
  id: "book:1", title: "Backend Basics", index: null,
  chapters: slugs.map((slug) => ({ url: `${SITE}/${slug}/`, title: slug })), ...extra,
});
const shelved = (id: string, slug: string, chapter: number, chapters: number): DocRecord => ({
  id, title: slug, text: "Already here.", source: "url", domain: "book.example", voice: null, chars: 13, createdAt: 1, updatedAt: 1,
  meta: { url: `${SITE}/${slug}/` }, book: { id: "book:1", title: "Backend Basics", chapter, chapters },
});
const page: ReadChapter = async (url) => ({ title: url, text: `The chapter at ${url} has plenty to say.`, domain: "book.example", meta: { url }, links: [] });

describe("adding a book's chapters on the server", () => {
  let directory: string, library: LibraryService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "readaloud-books-"));
    library = new LibraryService(directory);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("saves each missing chapter in its place, leaving the ones already shelved", async () => {
    await library.save([shelved("one", "01-http", 1, 3)]);
    const read: string[] = [];
    const imports = new BookImports(library, async (url) => { read.push(url); return page(url); });
    const { job, done } = imports.start(book(["01-http", "02-routing", "03-databases"]));
    await done;
    expect(read.sort()).toEqual([`${SITE}/02-routing/`, `${SITE}/03-databases/`]);
    const docs = await library.documents();
    expect(docs.map((d) => [d.book?.chapter, d.title]).sort()).toEqual([[1, "01-http"], [2, "02-routing"], [3, "03-databases"]]);
    expect(docs.find((d) => d.book?.chapter === 2)).toMatchObject({ source: "url", domain: "book.example", meta: { url: `${SITE}/02-routing/` }, book: { id: "book:1", chapters: 3 } });
    expect(job).toMatchObject({ bookId: "book:1", done: 2, total: 2, failed: 0 });
    expect(job.added).toHaveLength(2);
    expect(job.finishedAt).toBeTypeOf("number");
  });

  it("renumbers shelved chapters when the list has shifted, and takes in a page saved loose", async () => {
    const loose: DocRecord = { ...shelved("loose", "03-databases", 1, 1), book: undefined };
    delete loose.book;
    await library.save([shelved("routing", "02-routing", 1, 2), loose]);
    const imports = new BookImports(library, page);
    const { job, done } = imports.start(book(["01-http", "02-routing", "03-databases"]));
    await done;
    const byId = new Map((await library.documents()).map((d) => [d.id, d]));
    expect(byId.get("routing")?.book).toMatchObject({ chapter: 2, chapters: 3 });
    expect(byId.get("loose")?.book).toMatchObject({ chapter: 3, chapters: 3 });
    expect(byId.get("loose")?.text).toBe("Already here.");
    expect(byId.size).toBe(3);
    expect(job.added).toContain("loose");
  });

  it("counts chapters that can't be fetched, and starts reading at the earliest that arrived", async () => {
    const imports = new BookImports(library, async (url) => { if (url.includes("01")) throw new Error("gone"); return page(url); });
    const { job, done } = imports.start(book(["01-http", "02-routing", "03-databases"]));
    await done;
    expect(job).toMatchObject({ done: 3, total: 3, failed: 1 });
    const docs = await library.documents();
    expect(docs.find((d) => d.id === job.first)?.book?.chapter).toBe(2);
  });

  it("answers a second request for the same book with the import already running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const imports = new BookImports(library, async (url) => { await gate; return page(url); });
    const first = imports.start(book(["01-http", "02-routing"]));
    const again = imports.start(book(["01-http", "02-routing"]));
    expect(again.job).toBe(first.job);
    expect(imports.list()).toEqual([first.job]);
    release();
    await first.done;
    expect(await library.documents()).toHaveLength(2);
  });

  it("files chapters that came with their text without fetching anything", async () => {
    const imports = new BookImports(library, async () => { throw new Error("nothing to fetch"); });
    const text = book(["a", "b"], { file: "farmyard.epub", meta: { author: "A. Writer" } });
    text.chapters = text.chapters.map((c, i) => ({ ...c, text: `Chapter ${i + 1} is about the farmyard.` }));
    const { job, done } = imports.start(text);
    await done;
    expect(job.failed).toBe(0);
    expect((await library.documents()).every((d) => d.source === "file" && d.domain === "farmyard.epub" && d.meta?.author === "A. Writer")).toBe(true);
  });

  it("starts an import over HTTP and lists it, refusing other sites", async () => {
    const server = createServer(bookImportMiddleware(new BookImports(library, page)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const post = (headers: Record<string, string> = {}) => fetch(`${base}/import`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ book: book(["01-http"]) }) });
      expect((await post({ origin: "https://elsewhere.example" })).status).toBe(403);
      const started = await post();
      expect(started.status).toBe(200);
      expect((await started.json()).job).toMatchObject({ bookId: "book:1", title: "Backend Basics" });
      const { jobs } = await (await fetch(`${base}/import`)).json();
      expect(jobs.map((job: { bookId: string }) => job.bookId)).toEqual(["book:1"]);
      expect((await fetch(`${base}/import`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })).status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses a book that isn't one", () => {
    expect(() => bookFrom({})).toThrow("Invalid book.");
    expect(() => bookFrom({ book: { id: "b", title: "T", chapters: [] } })).toThrow("Invalid book.");
    expect(() => bookFrom({ book: { id: "b", title: "T", chapters: [{ url: "file:///etc/passwd", title: "x" }] } })).toThrow("Invalid book.");
    expect(bookFrom({ book: { ...book(["a"]), unread: ["x"], index: 0 } })).toEqual(book(["a"]));
  });
});

describe("reading a chapter on the server", () => {
  let server: Server;
  const asked: string[] = [];
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads the chapter's own page with no browser, asking no other page", async () => {
    const nav = `<nav><ol>${["1", "2", "3"].map((n) => `<li><a href="/part-${n}/">${n}. Part ${n}</a></li>`).join("")}</ol></nav>`;
    server = createServer((req, res) => {
      asked.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>Part 2</title></head><body>${nav}<main><article><h1>Part 2</h1><p>The buffer pool keeps pages in memory. It decides which page to evict.</p><a href="https://www.postgresql.org/docs/">More</a></article></main></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/part-2/`;
    const chapter = await readOnServer()(url);
    expect(chapter.text).toContain("The buffer pool keeps pages in memory.");
    expect(chapter.links.map((l) => l.url)).toContain("https://www.postgresql.org/docs/");
    expect(chapter.meta.url).toBe(url);
    expect(asked).toEqual(["/part-2/"]);
  });
});
