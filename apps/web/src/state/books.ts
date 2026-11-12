import { create } from "zustand";
import { docs as docStore, type DocBook, type DocRecord, type DocSource } from "../lib/db";
import { fetchReadable, hostOf, type Fetched } from "../lib/fetchUrl";
import { pageKey, type BookContents } from "../lib/book";
import { FINISHED_FRACTION } from "../lib/libraryProtocol";
import { updateDocument } from "./documents";
import { useCategories } from "./categories";
import { useLibrary, type LibraryItem } from "./library";
import { toast } from "./toast";

/** The chapter at `index` in the book's contents, as it is stored on the chapter's document. */
export const placeIn = (book: BookContents, index: number): DocBook => ({ id: book.id, title: book.title, chapter: index + 1, chapters: book.chapters.length });

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
   * Fetch every chapter the library doesn't have yet, in order. `onFirst` runs once the first of
   * them is in the library, so reading can start while the rest arrive.
   */
  add: (book: BookContents, opts?: { onFirst?: (rec: DocRecord) => Promise<void> | void }) => Promise<AddResult>;
  /** Add the rest of a book from one of its chapters, by reading the chapter list off its page again. */
  complete: (rec: DocRecord) => Promise<AddResult | null>;
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
    set({ adding: { ...get().adding, [book.id]: { done: 0, total: book.chapters.length } } });
    let added = 0, failed = 0;
    // Chapters that came with their text: nothing to wait for between them, so they go in as one batch.
    const batch: DocRecord[] = [];
    // Opening the first chapter can take a minute (code explanations); the rest keep arriving meanwhile.
    let first: Promise<void> | undefined;
    try {
      const all = await docStore.all();
      const have = shelved(all, book.id);
      const byPage = new Map(all.flatMap((rec) => rec.meta?.url && !rec.book ? [[pageKey(rec.meta.url), rec] as const] : []));
      const missing = book.chapters.map((chapter, index) => ({ ...chapter, index })).filter((chapter) => !have.has(chapter.index + 1));
      set({ adding: { ...get().adding, [book.id]: { done: 0, total: missing.length } } });
      for (const [done, chapter] of missing.entries()) {
        const place = placeIn(book, chapter.index);
        let rec: DocRecord | undefined;
        try {
          // A chapter saved earlier as a loose article joins the book instead of being fetched twice.
          const loose = chapter.text === undefined ? byPage.get(pageKey(chapter.url)) : undefined;
          if (loose) rec = await useLibrary.getState().update(loose.id, { book: place, title: chapter.title });
          else if (chapter.text !== undefined) {
            rec = await useLibrary.getState().create({ text: chapter.text, title: chapter.title, source: "url", domain: hostOf(chapter.url), meta: book.meta ?? { url: chapter.url }, book: place, batch: true });
            batch.push(rec);
          } else {
            const page = await fetchReadable(chapter.url);
            rec = await useLibrary.getState().create({ text: page.text, title: chapter.title, source: "url", domain: page.domain, meta: page.meta, links: page.links, book: place });
          }
        } catch { /* Counted below; the rest of the book still arrives. */ }
        if (rec) {
          if (++added === 1) first = Promise.resolve(opts.onFirst?.(rec)).catch(() => {});
        } else failed++;
        set({ adding: { ...get().adding, [book.id]: { done: done + 1, total: missing.length } } });
      }
      await first;
    } finally {
      if (batch.length) {
        await useLibrary.getState().refresh();
        void fileInTurn(batch);
      }
      const { [book.id]: _, ...adding } = get().adding;
      // Every page of the book made the same offer; it has been taken up.
      set({ adding, offers: Object.fromEntries(Object.entries(get().offers).filter(([, offer]) => offer.id !== book.id || failed > 0)) });
    }
    toast(failed
      ? added ? `Added ${added} ${added === 1 ? "chapter" : "chapters"}; ${failed} couldn't be fetched. Add the rest from your Library.` : "Couldn't fetch the chapters. Check your connection and try again."
      : added ? `Added ${added} ${added === 1 ? "chapter" : "chapters"} of ${book.title}` : "Every chapter is already in your Library", 4000);
    return { added, failed };
  },
  async complete(rec) {
    if (!rec.book || !rec.meta?.url) return null;
    let book: BookContents | undefined;
    try { book = (await fetchReadable(rec.meta.url)).book; } catch { /* Reported below. */ }
    if (!book || book.id !== rec.book.id) {
      toast("Couldn't find the chapter list on that page");
      return null;
    }
    // Keep the title the book already has on the shelf.
    return get().add({ ...book, title: rec.book.title });
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
}

export const finished = (it: Pick<LibraryItem, "progress" | "reads">) => it.reads > 0 || it.progress >= FINISHED_FRACTION;

/** The library's chapters of each book, in reading order. */
export function shelves(items: LibraryItem[]): Map<string, Shelf> {
  const out = new Map<string, Shelf>();
  for (const it of items) {
    const book = it.rec.book;
    if (!book) continue;
    const shelf = out.get(book.id) ?? { id: book.id, title: book.title, items: [], chapters: 0 };
    shelf.items.push(it);
    shelf.chapters = Math.max(shelf.chapters, book.chapters, book.chapter);
    out.set(book.id, shelf);
  }
  // The same chapter imported twice keeps the order the copies were added in.
  for (const shelf of out.values()) shelf.items.sort((a, b) => a.rec.book!.chapter - b.rec.book!.chapter || a.rec.createdAt - b.rec.createdAt);
  return out;
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
