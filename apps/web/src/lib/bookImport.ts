import type { DocBook, DocRecord } from "./db";
import { pageKey, type BookChapter, type BookContents } from "./book";

/** The chapter at `index` in the book's contents, as it is stored on the chapter's document. */
export const placeIn = (book: BookContents, index: number): DocBook => ({
  id: book.id, title: book.title, chapter: index + 1, chapters: book.chapters.length,
  ...(book.kind ? { kind: book.kind } : {}), ...(book.contents ? { contents: book.contents } : {}),
});

export interface ChapterPlan {
  /** Chapters already shelved whose number or the book's length has changed since */
  moved: { rec: DocRecord; book: DocBook }[];
  /** Chapters the library doesn't have yet, in reading order */
  missing: (BookChapter & {
    index: number;
    /** The same page saved earlier as a loose article, which joins the book instead of being fetched twice */
    loose?: DocRecord;
  })[];
}

/** What adding the book to a library holding `all` comes to. */
export function planChapters(book: BookContents, all: DocRecord[]): ChapterPlan {
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
  // The list can have grown or shifted since (a course posts lectures as it runs): what is shelved follows it.
  const moved = parts.flatMap(({ rec, index }) => {
    const place = placeIn(book, index);
    const shelved = rec?.book;
    return rec && shelved && (shelved.chapter !== place.chapter || shelved.chapters !== place.chapters)
      ? [{ rec, book: { ...shelved, chapter: place.chapter, chapters: place.chapters } }] : [];
  });
  const missing = parts.filter((part) => !part.rec && !taken.has(part.index + 1)).map(({ rec: _, ...chapter }) => {
    const loose = chapter.text === undefined ? byPage.get(pageKey(chapter.url)) : undefined;
    return loose ? { ...chapter, loose } : chapter;
  });
  return { moved, missing };
}

/** A book being added by the server, as the app follows it. */
export interface BookImportJob {
  bookId: string;
  title: string;
  kind?: "course";
  /** Chapters tried so far, out of `total` */
  done: number;
  total: number;
  /** Chapters that couldn't be fetched or saved */
  failed: number;
  /** Documents added, in the order they arrived */
  added: string[];
  /** The earliest chapter added, once every chapter before it has been tried: where reading starts */
  first?: string;
  startedAt: number;
  /** Set once every chapter has been tried */
  finishedAt?: number;
}
