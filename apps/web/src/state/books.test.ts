import { describe, it, expect } from "vitest";
import type { DocRecord } from "../lib/db";
import type { LibraryItem } from "./library";
import { finished, neighbours, nextUnread, placeIn, shelves } from "./books";

const BOOK = { id: "book:1", title: "Backend Basics" };
const item = (id: string, chapter: number | null, state: Partial<Pick<LibraryItem, "progress" | "reads">> = {}, createdAt = chapter ?? 0): LibraryItem => ({
  rec: { id, title: id, text: "", source: "url", domain: "book.example", voice: null, chars: 0, createdAt, updatedAt: createdAt,
    ...(chapter ? { book: { ...BOOK, chapter, chapters: 5 } } : {}) } as DocRecord,
  progress: 0, duration: 600, reads: 0, prepared: [], ...state,
});

describe("a book's chapters in the library", () => {
  // Newest first, as the Library lists them, with a loose article in between.
  const items = [item("c4", 4), item("article", null), item("c2", 2, { progress: 0.4 }), item("c1", 1, { reads: 1 })];

  it("shelves chapters in reading order and knows how long the whole book is", () => {
    const shelf = shelves(items).get("book:1")!;
    expect(shelf.items.map((it) => it.rec.id)).toEqual(["c1", "c2", "c4"]);
    expect(shelf).toMatchObject({ title: "Backend Basics", chapters: 5 });
    expect(shelves([item("article", null)]).size).toBe(0);
  });

  it("finds the chapters either side, skipping ones that are not in the library", () => {
    const at = (id: string) => neighbours(items, items.find((it) => it.rec.id === id)!.rec);
    expect(at("c2").previous?.rec.id).toBe("c1");
    expect(at("c2").next?.rec.id).toBe("c4");
    expect(at("c1").previous).toBeUndefined();
    expect(at("c4").next).toBeUndefined();
    expect(at("article")).toEqual({});
  });

  it("picks the book up at the first unfinished chapter, or the start once all are read", () => {
    expect(nextUnread(shelves(items).get("book:1")!).rec.id).toBe("c2");
    const done = [item("c1", 1, { reads: 2 }), item("c2", 2, { progress: 1 })];
    expect(done.every(finished)).toBe(true);
    expect(nextUnread(shelves(done).get("book:1")!).rec.id).toBe("c1");
  });

  it("numbers chapters from one", () => {
    const book = { id: "book:1", title: "Backend Basics", chapters: [{ url: "a", title: "A" }, { url: "b", title: "B" }], index: null };
    expect(placeIn(book, 1)).toEqual({ id: "book:1", title: "Backend Basics", chapter: 2, chapters: 2 });
  });
});
