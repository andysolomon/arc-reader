import { create } from "zustand";
import { docs as docStore, type DocRecord, type DocSource } from "../lib/db";
import { fetchReadable, hostOf, type Fetched } from "../lib/fetchUrl";
import { partNames, type BookContents } from "../lib/book";
import { placeIn, planChapters, type BookImportJob } from "../lib/bookImport";
import { syncLibrary } from "../lib/librarySync";
import { FINISHED_FRACTION } from "../lib/libraryProtocol";
import { useCategories } from "./categories";
import { useLibrary, type LibraryItem } from "./library";
import { toast } from "./toast";

export { placeIn };

/** Chapter numbers of the book that are already in the library. */
const shelved = (all: DocRecord[], bookId: string) => new Set(all.flatMap((rec) => rec.book?.id === bookId ? [rec.book.chapter] : []));

/** Chapters that arrive together are filed two at a time, not in one burst of requests to Jev. */
async function fileInTurn(recs: DocRecord[]) {
  const queue = [...recs];
  const worker = async () => {
    for (let rec = queue.shift(); rec; rec = queue.shift()) await useCategories.getState().suggest(rec, { quiet: true });
  };
  await Promise.all([worker(), worker()]);
}

export interface AddResult {
  added: number;
  failed: number;
}

interface BooksState {
  /** Books found on pages just imported, keyed by the document that came from the page */
  offers: Record<string, BookContents>;
  /** Chapters being fetched right now, keyed by book */
  adding: Record<string, { done: number; total: number }>;
  dismiss: (docId: string) => void;
  /**
   * Add every chapter the library doesn't have yet. A book with pages to fetch is added by the
   * server, so it keeps arriving with the app closed. `onFirst` runs once the first of them is in
   * the library, so reading can start while the rest arrive.
   */
  add: (book: BookContents, opts?: { onFirst?: (rec: DocRecord) => Promise<void> | void }) => Promise<AddResult>;
  /** Add the rest of a book from one of its chapters, by reading the chapter list off its page again. */
  complete: (rec: DocRecord) => Promise<AddResult | null>;
  /** Follow the server's imports, including ones started before the app was last open. */
  watch: () => void;
}

const report = (book: { title: string; kind?: "course" }, { added, failed }: AddResult) => {
  const { one, many } = partNames(book);
  toast(failed
    ? added ? `Added ${added} ${added === 1 ? one : many}; ${failed} couldn't be fetched. Add the rest from your Library.` : `Couldn't fetch the ${many}. Check your connection and try again.`
    : added ? `Added ${added} ${added === 1 ? one : many} of ${book.title}` : book.kind === "course" ? "No new lectures have been posted" : "Every chapter is already in your Library", 4000);
};

/** An import this app started or saw running, waiting to hear how it ends. */
interface Follower {
  /** The import's start on the server, once known */
  startedAt?: number;
  /** When this app began following it: a list asked for before then can't be expected to show it */
  since: number;
  onFirst?: (rec: DocRecord) => Promise<void> | void;
  opened?: boolean;
  resolve: (result: AddResult) => void;
}
const following = new Map<string, Follower>();
/** Imports that finished while the app was away, whose chapters have since been filed */
const filed = new Set<string>();
const POLL_MS = 1500;
let polling = false;

const listImports = async (): Promise<BookImportJob[]> => {
  const r = await fetch("/api/books/import", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json() as { jobs: BookImportJob[] }).jobs;
};

/** The documents, once the library sync has brought them to this device. */
async function pulled(ids: string[]): Promise<DocRecord[]> {
  // A sync already under way may have asked before the newest of them were saved.
  for (let round = 0; round < 2; round++) {
    await syncLibrary();
    const recs = (await Promise.all(ids.map((id) => docStore.get(id)))).filter((rec): rec is DocRecord => !!rec);
    if (recs.length === ids.length || round === 1) {
      await useLibrary.getState().refresh();
      return recs;
    }
  }
  return [];
}

const stopAdding = (bookId: string, failed: boolean) => {
  const { [bookId]: _, ...adding } = useBooks.getState().adding;
  // Every page of the book made the same offer; it has been taken up.
  useBooks.setState({ adding, offers: Object.fromEntries(Object.entries(useBooks.getState().offers).filter(([, offer]) => offer.id !== bookId || failed)) });
};

/** Mirror the server's imports into `adding` until none is left running or awaited. */
async function poll() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const asked = Date.now();
      let jobs: BookImportJob[];
      try {
        jobs = await listImports();
      } catch {
        // Out of reach for now: the server carries on, and we ask again until it answers.
        if (!following.size) break;
        await new Promise((r) => setTimeout(r, POLL_MS * 3));
        continue;
      }
      const byBook = new Map(jobs.map((job) => [job.bookId, job]));
      for (const job of jobs) {
        const follower = following.get(job.bookId);
        if (!job.finishedAt) {
          // An import started elsewhere, or before the app was last open, is followed from here on.
          if (!follower) following.set(job.bookId, { startedAt: job.startedAt, since: Date.now(), resolve: () => {} });
          else follower.startedAt ??= job.startedAt;
          useBooks.setState({ adding: { ...useBooks.getState().adding, [job.bookId]: { done: job.done, total: job.total } } });
        }
        const current = following.get(job.bookId);
        const key = `${job.bookId}@${job.startedAt}`;
        if (!current && job.finishedAt && !filed.has(key)) {
          // Finished with the app closed: the chapters came by sync, and are filed now.
          filed.add(key);
          void pulled(job.added).then((recs) => fileInTurn(recs.filter((rec) => !rec.category)));
        }
        if (!current || (current.startedAt !== undefined && current.startedAt !== job.startedAt)) continue;
        if (job.first && current.onFirst && !current.opened) {
          current.opened = true;
          const [first] = await pulled([job.first]);
          if (first) await Promise.resolve(current.onFirst(first)).catch(() => {});
        }
        if (job.finishedAt) {
          filed.add(key);
          following.delete(job.bookId);
          stopAdding(job.bookId, job.failed > 0);
          const recs = await pulled(job.added);
          void fileInTurn(recs.filter((rec) => !rec.category));
          const result = { added: job.added.length, failed: job.failed };
          report(job, result);
          current.resolve(result);
        }
      }
      // The server lost an import it was running (it restarted): what arrived stays, the Library offers the rest.
      for (const [bookId, follower] of following) {
        if (follower.since > asked || follower.startedAt === undefined || byBook.get(bookId)?.startedAt === follower.startedAt) continue;
        following.delete(bookId);
        stopAdding(bookId, true);
        await pulled([]);
        toast("Adding chapters stopped partway. Add the rest from your Library.", 4000);
        follower.resolve({ added: 0, failed: 1 });
      }
      if (!following.size) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    polling = false;
  }
}

/** A book that came with every chapter's text, from a file: nothing to fetch, so it goes in here and at once. */
async function addHere(book: BookContents, opts: { onFirst?: (rec: DocRecord) => Promise<void> | void }): Promise<AddResult> {
  const get = useBooks.getState, set = useBooks.setState;
  let added = 0, failed = 0;
  const batch: DocRecord[] = [];
  let first: Promise<void> | undefined;
  try {
    const { moved, missing } = planChapters(book, await docStore.all());
    set({ adding: { ...get().adding, [book.id]: { done: 0, total: missing.length } } });
    for (const { rec, book: place } of moved) await useLibrary.getState().update(rec.id, { book: place }).catch(() => undefined);
    for (const [done, chapter] of missing.entries()) {
      try {
        const rec = await useLibrary.getState().create({ text: chapter.text!, title: chapter.title, source: book.file ? "file" : "url", domain: book.file ?? hostOf(chapter.url), meta: book.meta ?? { url: chapter.url }, book: placeIn(book, chapter.index), batch: true });
        batch.push(rec);
        if (++added === 1) first = Promise.resolve(opts.onFirst?.(rec)).catch(() => {});
      } catch {
        failed++;
      }
      set({ adding: { ...get().adding, [book.id]: { done: done + 1, total: missing.length } } });
    }
    await first;
  } finally {
    if (batch.length) {
      await useLibrary.getState().refresh();
      void fileInTurn(batch);
    }
    stopAdding(book.id, failed > 0);
  }
  report(book, { added, failed });
  return { added, failed };
}

export const useBooks = create<BooksState>()((set, get) => ({
  offers: {},
  adding: {},
  dismiss(docId) {
    const { [docId]: _, ...offers } = get().offers;
    set({ offers });
  },
  async add(book, opts = {}) {
    if (get().adding[book.id]) return { added: 0, failed: 0 };
    if (book.chapters.every((chapter) => chapter.text !== undefined)) return addHere(book, opts);
    // Shown as looking for the chapters until the server has counted them.
    set({ adding: { ...get().adding, [book.id]: { done: 0, total: 0 } } });
    let job: BookImportJob;
    try {
      // What is saved here and not yet on the server would otherwise be added twice.
      await syncLibrary();
      const r = await fetch("/api/books/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ book }), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      job = (await r.json() as { job: BookImportJob }).job;
    } catch {
      stopAdding(book.id, true);
      toast(`Couldn't start adding the ${partNames(book).many}. Check your connection and try again.`, 4000);
      return { added: 0, failed: 0 };
    }
    const result = new Promise<AddResult>((resolve) => {
      const known = following.get(book.id);
      following.set(book.id, { startedAt: job.startedAt, since: Date.now(), onFirst: opts.onFirst, opened: known?.opened, resolve: (r) => { known?.resolve(r); resolve(r); } });
    });
    set({ adding: { ...get().adding, [book.id]: { done: job.done, total: job.total } } });
    void poll();
    return result;
  },
  async complete(rec) {
    const id = rec.book?.id;
    if (!rec.book || !id || get().adding[id]) return null;
    let book: BookContents | undefined;
    // Shown as looking for the list until there are chapters to count.
    set({ adding: { ...get().adding, [id]: { done: 0, total: 0 } } });
    try {
      // Where the chapters do not list each other (a course's decks are files), the page that lists them is asked.
      for (const url of [rec.book.contents, rec.meta?.url]) {
        if (!url) continue;
        try {
          const found = (await fetchReadable(url)).book;
          if (found?.id === id) { book = found; break; }
        } catch { /* Reported below. */ }
      }
    } finally {
      const { [id]: _, ...adding } = get().adding;
      set({ adding });
    }
    if (!book) {
      toast(`Couldn't find the ${partNames(rec.book).one} list on that page`);
      return null;
    }
    // Keep the title the book already has on the shelf.
    return get().add({ ...book, title: rec.book.title });
  },
  watch() {
    void poll();
  },
}));

/**
 * Save a fetched page as a library document. A chapter takes its title and place from the
 * book, and a page that reveals a book with chapters still to add leaves an offer to add them.
 */
export async function importPage(page: Fetched, opts: { source: DocSource; title?: string }): Promise<DocRecord> {
  const { book } = page;
  const chapter = book && book.index !== null ? book.chapters[book.index] : null;
  const rec = await useLibrary.getState().create({
    text: page.text, title: chapter?.title ?? opts.title ?? page.title, source: opts.source, domain: page.domain, meta: page.meta, links: page.links,
    ...(book && chapter ? { book: placeIn(book, book.index!) } : {}),
  });
  if (book) {
    const have = shelved(await docStore.all().catch(() => []), book.id);
    if (book.chapters.some((_, index) => !have.has(index + 1))) useBooks.setState({ offers: { ...useBooks.getState().offers, [rec.id]: book } });
  }
  return rec;
}

/** A page that only lists a book's chapters: worth replacing with the chapters, not worth reading aloud. */
export const isContentsPage = (page: Fetched) => !!page.book && page.book.index === null;

export interface Shelf {
  id: string;
  title: string;
  /** Chapters in the library, in reading order */
  items: LibraryItem[];
  /** Chapters in the whole book */
  chapters: number;
  /** A course, whose chapters are lectures */
  kind?: "course";
  /** The page that lists the chapters, when there is one to ask again */
  contents?: string;
}

export const finished = (it: Pick<LibraryItem, "progress" | "reads">) => it.reads > 0 || it.progress >= FINISHED_FRACTION;

/** The library's chapters of each book, in reading order. */
export function shelves(items: LibraryItem[]): Map<string, Shelf> {
  const out = new Map<string, Shelf>();
  for (const it of items) {
    const book = it.rec.book;
    if (!book) continue;
    const shelf: Shelf = out.get(book.id) ?? { id: book.id, title: book.title, items: [], chapters: 0 };
    shelf.items.push(it);
    if (book.kind) shelf.kind = book.kind;
    if (book.contents) shelf.contents = book.contents;
    shelf.chapters = Math.max(shelf.chapters, book.chapters, book.chapter);
    out.set(book.id, shelf);
  }
  // The same chapter imported twice keeps the order the copies were added in.
  for (const shelf of out.values()) shelf.items.sort((a, b) => a.rec.book!.chapter - b.rec.book!.chapter || a.rec.createdAt - b.rec.createdAt);
  return out;
}

/** One line of a document list: a document, or a book standing in for its chapters. */
export type LibraryEntry = { kind: "doc"; it: LibraryItem } | { kind: "book"; shelf: Shelf; duration: number };

/** Two or more chapters of a book share one entry, placed where its newest chapter would be. */
export function entriesOf(items: LibraryItem[]): LibraryEntry[] {
  const books = shelves(items);
  const placed = new Set<string>();
  const list: LibraryEntry[] = [];
  for (const it of items) {
    const shelf = it.rec.book ? books.get(it.rec.book.id) : undefined;
    if (!shelf || shelf.items.length < 2) list.push({ kind: "doc", it });
    else if (!placed.has(shelf.id)) {
      placed.add(shelf.id);
      list.push({ kind: "book", shelf, duration: shelf.items.reduce((sum, chapter) => sum + chapter.duration, 0) });
    }
  }
  return list;
}

/** The chapters before and after this one that are in the library. */
export function neighbours(items: LibraryItem[], rec: DocRecord): { previous?: LibraryItem; next?: LibraryItem } {
  if (!rec.book) return {};
  const chapters = shelves(items).get(rec.book.id)?.items ?? [];
  return {
    previous: chapters.filter((it) => it.rec.book!.chapter < rec.book!.chapter).pop(),
    next: chapters.find((it) => it.rec.book!.chapter > rec.book!.chapter),
  };
}

/** Where to pick a book up: the first chapter not yet finished, or the start once all are. */
export const nextUnread = (shelf: Shelf): LibraryItem => shelf.items.find((it) => !finished(it)) ?? shelf.items[0];
