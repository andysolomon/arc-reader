import { describe, it, expect } from "vitest";
import type { DocRecord } from "../lib/db";
import type { LibraryItem } from "./library";
import { entriesOf, finished, neighbours, nextInSeries, nextUnread, placeIn, seriesOf, shelves } from "./books";

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

  it("remembers that a course is one, and the page that lists its lectures", () => {
    const course = { id: "book:2", title: "CS 101", chapters: [{ url: "a", title: "A" }], index: null, kind: "course" as const, contents: "https://cs101.example/" };
    expect(placeIn(course, 0)).toEqual({ id: "book:2", title: "CS 101", chapter: 1, chapters: 1, kind: "course", contents: "https://cs101.example/" });
    const lecture = item("l1", 1);
    lecture.rec.book = placeIn(course, 0);
    expect(shelves([lecture]).get("book:2")).toMatchObject({ kind: "course", contents: "https://cs101.example/" });
  });
});

describe("the volumes of a series", () => {
  const volume = (n: number, name: string) => ({ id: `vol:${n}`, title: `Field Notes: Volume ${n} — ${name}` });
  const chapter = (id: string, book: { id: string; title: string }, n: number, state: Partial<Pick<LibraryItem, "progress" | "reads">> = {}): LibraryItem => ({
    ...item(id, null, state, n), rec: { ...item(id, null, {}, n).rec, book: { ...book, chapter: n, chapters: 2 } },
  });
  const [one, two, three] = [volume(1, "Soil"), volume(2, "Water"), volume(3, "Light")];
  // Newest first: volume 3 came last, and only its first chapter is in the library.
  const items = [chapter("v3c1", three, 1), chapter("v2c2", two, 2), chapter("v2c1", two, 1), item("article", null), item("c2", 2), item("c1", 1), chapter("v1c2", one, 2, { reads: 1 }), chapter("v1c1", one, 1, { reads: 1 })];

  it("groups the books whose titles differ only after the series' name, in volume order", () => {
    const series = seriesOf(shelves(items)).get("vol:2")!;
    expect(series.title).toBe("Field Notes");
    expect(series.volumes.map((v) => [v.volume, v.title, v.shelf.id])).toEqual([[1, "Volume 1 — Soil", "vol:1"], [2, "Volume 2 — Water", "vol:2"], [3, "Volume 3 — Light", "vol:3"]]);
    expect(seriesOf(shelves(items)).has("book:1")).toBe(false);
  });

  it("takes two volumes to make a series", () => {
    expect(seriesOf(shelves(items.filter((it) => it.rec.book?.id !== "vol:1" && it.rec.book?.id !== "vol:3"))).size).toBe(0);
  });

  it("lists the series once, where its newest chapter is, with a lone chapter of a volume inside it", () => {
    const entries = entriesOf(items);
    expect(entries.map((entry) => entry.kind)).toEqual(["series", "doc", "book"]);
    expect(entries[0]).toMatchObject({ kind: "series", duration: 5 * 600 });
  });

  it("reads on from the end of one volume into the next", () => {
    const at = (id: string) => neighbours(items, items.find((it) => it.rec.id === id)!.rec);
    expect(at("v1c2").next?.rec.id).toBe("v2c1");
    expect(at("v2c1").previous?.rec.id).toBe("v1c2");
    expect(at("v2c1").next?.rec.id).toBe("v2c2");
    expect(at("v3c1").next).toBeUndefined();
    expect(at("v1c1").previous).toBeUndefined();
  });

  it("picks the series up in the first volume with something left to read", () => {
    const series = seriesOf(shelves(items)).get("vol:1")!;
    expect(nextInSeries(series).rec.id).toBe("v2c1");
    const done = items.map((it) => ({ ...it, reads: 1 }));
    expect(nextInSeries(seriesOf(shelves(done)).get("vol:1")!).rec.id).toBe("v1c1");
  });
});
