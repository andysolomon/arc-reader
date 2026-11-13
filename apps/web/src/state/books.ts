import { create } from "zustand";
import { docs as docStore, type DocBook, type DocRecord, type DocSource } from "../lib/db";
import { fetchReadable, hostOf, type Fetched } from "../lib/fetchUrl";
import { pageKey, partNames, type BookContents } from "../lib/book";
import { FINISHED_FRACTION } from "../lib/libraryProtocol";
import { updateDocument } from "./documents";
import { useCategories } from "./categories";
import { useLibrary, type LibraryItem } from "./library";
import { toast } from "./toast";

/** The chapter at `index` in the book's contents, as it is stored on the chapter's document. */
export const placeIn = (book: BookContents, index: number): DocBook => ({
  id: book.id, title: book.title, chapter: index + 1, chapters: book.chapters.length,
  ...(book.kind ? { kind: book.kind } : {}), ...(book.contents ? { contents: book.contents } : {}),
});

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
      const byPage = new Map(all.flatMap((rec) => rec.meta?.url && !rec.book ? [[pageKey(rec.meta.url), rec] as const] : []));
      // Chapters already shelved are known by their addresses; one saved without an address keeps its number.
      const mine = all.filter((rec) => rec.book?.id === book.id);
      const byAddress = new Map(mine.flatMap((rec) => rec.meta?.url ? [[pageKey(rec.meta.url), rec] as const] : []));
      // Chapters cut from one text share its address, which tells them apart no better than no address at all.
      const sharing = new Map<string, number>();
      for (const chapter of book.chapters) sharing.set(pageKey(chapter.url), (sharing.get(pageKey(chapter.url)) ?? 0) + 1);
      const parts = book.chapters.map((chapter, index) => ({ ...chapter, index, rec: sharing.get(pageKey(chapter.url)) === 1 ? byAddress.get(pageKey(chapter.url)) : undefined }));
      const listed = new Set(parts.flatMap((part) => part.rec ? [part.rec.id] : []));
      const taken = new Set(mine.filter((rec) => !listed.has(rec.id)).map((rec) => rec.book!.chapter));
      const missing = parts.filter((part) => !part.rec && !taken.has(part.index + 1));
      set({ adding: { ...get().adding, [book.id]: { done: 0, total: missing.length } } });
      // The list can have grown or shifted since (a course posts lectures as it runs): what is shelved follows it.
      for (const part of parts) {
        const place = placeIn(book, part.index);
        const shelved = part.rec?.book;
        if (part.rec && shelved && (shelved.chapter !== place.chapter || shelved.chapters !== place.chapters)) {
          await useLibrary.getState().update(part.rec.id, { book: { ...shelved, chapter: place.chapter, chapters: place.chapters } }).catch(() => undefined);
        }
      }
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
    const { one, many } = partNames(book);
    toast(failed
      ? added ? `Added ${added} ${added === 1 ? one : many}; ${failed} couldn't be fetched. Add the rest from your Library.` : `Couldn't fetch the ${many}. Check your connection and try again.`
      : added ? `Added ${added} ${added === 1 ? one : many} of ${book.title}` : book.kind === "course" ? "No new lectures have been posted" : "Every chapter is already in your Library", 4000);
    return { added, failed };
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
