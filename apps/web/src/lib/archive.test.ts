import { afterEach, describe, it, expect, vi } from "vitest";
import { archiveBook, archiveItem, fetchArchiveBook, textFile, LENT_ONLY, type ArchiveItem } from "./archive";
import { ReadError } from "./readError";

const para = (about: string) => Array.from({ length: 6 }, (_, i) => `${about} went on in sentence ${i + 1}, long enough that the paragraph reads as prose.`).join(" ");
const chapter = (n: string, title: string) => [`CHAPTER ${n}.\n${title.toUpperCase()}.`, ...Array.from({ length: 4 }, (_, i) => para(`${title} ${i + 1}`))].join("\n\n");
const TEXT = [chapter("I", "The Arrival"), chapter("II", "Father and Son"), chapter("III", "The Catalans")].join("\n\n");

const OPEN: ArchiveItem = {
  metadata: { identifier: "countofmontecris01duma", mediatype: "texts", title: "The Count of Monte-Cristo", volume: "1", creator: ["Dumas, Alexandre, 1802-1870", "Maquet, Auguste, 1813-1888"], date: "1888", description: "Written in <i>collaboration</i> with Auguste Maquet" },
  files: [
    { name: "countofmontecris01duma.pdf", format: "Text PDF", size: "24927307" },
    { name: "countofmontecris01duma_djvu.txt", format: "DjVuTXT", size: "678906" },
    { name: "countofmontecris01duma_meta.xml", format: "Metadata", size: "2653" },
  ],
};
const LENT: ArchiveItem = {
  metadata: { identifier: "countofmontecris0000alex_k5l0", mediatype: "texts", title: "The Count of Monte Cristo", "access-restricted-item": "true", collection: ["printdisabled", "inlibrary"] },
  files: [{ name: "countofmontecris0000alex_k5l0_djvu.txt", format: "DjVuTXT", size: "113454", private: "true" }],
};

describe("links to the Internet Archive", () => {
  it("names the item wherever in it the link points", () => {
    expect(archiveItem("https://archive.org/details/countofmontecris0000alex_k5l0/page/n7/mode/1up")).toEqual({ id: "countofmontecris0000alex_k5l0" });
    expect(archiveItem("https://www.archive.org/stream/countofmontecris01duma/countofmontecris01duma_djvu.txt")).toEqual({ id: "countofmontecris01duma" });
    expect(archiveItem("https://archive.org/download/thecountofmontec01184gut/crsto11.txt")).toEqual({ id: "thecountofmontec01184gut", file: "crsto11.txt" });
    expect(archiveItem("https://archive.org/details/")).toBeNull();
    expect(archiveItem("https://archive.org/about/")).toBeNull();
    expect(archiveItem("https://web.archive.org/web/2020/https://example.com/details/book")).toBeNull();
    expect(archiveItem("https://example.com/details/book")).toBeNull();
  });

  it("reads the scan's text, or the latest transcription, or the file the link asked for", () => {
    expect(textFile(OPEN.files!)?.name).toBe("countofmontecris01duma_djvu.txt");
    const editions = [{ name: "crsto10.txt", format: "Text", size: "2689721" }, { name: "crsto12.txt", format: "Text", size: "2689763" }, { name: "crsto11.txt", format: "Text", size: "2689727" }, { name: "book_meta.txt", size: "9999999" }];
    expect(textFile(editions)?.name).toBe("crsto12.txt");
    expect(textFile(editions, "crsto11.txt")?.name).toBe("crsto11.txt");
    expect(textFile([{ name: "book.pdf", format: "Text PDF" }])).toBeUndefined();
  });
});

describe("a book from the Internet Archive", () => {
  const page = archiveBook("countofmontecris01duma", OPEN.metadata!, TEXT);

  it("arrives as its first chapter, with every chapter's text ready to add", () => {
    expect(page.text.startsWith("# Chapter 1: The Arrival\n\nThe Arrival 1 went on")).toBe(true);
    expect(page.book).toMatchObject({ title: "The Count of Monte-Cristo, volume 1", index: 0 });
    expect(page.book!.chapters.map((c) => c.title)).toEqual(["The Arrival", "Father and Son", "The Catalans"]);
    expect(page.book!.chapters[0].text).toBe(page.text);
    expect(page.book!.chapters[2].text).toContain("The Catalans 4 went on");
    // Fetched again later, from any link into the item, it is the same book.
    expect(page.book!.id).toBe(archiveBook("countofmontecris01duma", { title: "Renamed" }, TEXT).book!.id);
    expect(page.book!.id).not.toBe(archiveBook("countofmontecris02duma", OPEN.metadata!, TEXT).book!.id);
  });

  it("is catalogued from the item's record", () => {
    expect(page).toMatchObject({ title: "The Count of Monte-Cristo, volume 1", domain: "archive.org" });
    expect(page.meta).toEqual({
      url: "https://archive.org/details/countofmontecris01duma", author: "Alexandre Dumas, Auguste Maquet", published: "1888",
      site: "Internet Archive", description: "Written in collaboration with Auguste Maquet",
    });
    expect(page.book!.meta).toEqual(page.meta);
    expect(archiveBook("x", { title: "Works. Volume 2", volume: "2", creator: "Jane Austen" }, TEXT)).toMatchObject({ title: "Works. Volume 2", meta: { author: "Jane Austen" } });
  });

  it("is one document when it is too short to divide", () => {
    const short = archiveBook("pamphlet", { title: "A Pamphlet" }, para("The pamphlet"));
    expect(short.book).toBeUndefined();
    expect(short).toMatchObject({ title: "A Pamphlet", text: para("The pamphlet") });
    expect(() => archiveBook("blank", { title: "Blank" }, "\n\n")).toThrow(ReadError);
  });
});

describe("fetching from the Internet Archive", () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  /** The Archive as the browser reaches it, answering from `routes` by address. */
  const serve = (routes: Record<string, () => Response>) => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      seen.push(input);
      const route = routes[input];
      if (!route) throw new TypeError("Failed to fetch");
      return route();
    }));
    return seen;
  };

  it("reads the book from the item's text file", async () => {
    const seen = serve({
      "https://archive.org/metadata/countofmontecris01duma": () => json(OPEN),
      "https://archive.org/download/countofmontecris01duma/countofmontecris01duma_djvu.txt": () => new Response(TEXT),
    });
    const page = await fetchArchiveBook("https://archive.org/details/countofmontecris01duma/page/n7/mode/1up");
    expect(page?.book?.chapters).toHaveLength(3);
    expect(seen).toHaveLength(2);
  });

  it("says so when the book is only lent, without asking for its text", async () => {
    const seen = serve({ "https://archive.org/metadata/countofmontecris0000alex_k5l0": () => json(LENT) });
    await expect(fetchArchiveBook("https://archive.org/details/countofmontecris0000alex_k5l0/page/n7/mode/1up")).rejects.toThrow(new ReadError(LENT_ONLY));
    expect(seen).toHaveLength(1);
  });

  it("says so when the text can't be had right now, instead of importing the viewer's page", async () => {
    serve({
      "https://archive.org/metadata/countofmontecris01duma": () => json(OPEN),
      "https://archive.org/download/countofmontecris01duma/countofmontecris01duma_djvu.txt": () => new Response("Internal Server Error", { status: 500 }),
      [`/api/fetch?url=${encodeURIComponent("https://archive.org/download/countofmontecris01duma/countofmontecris01duma_djvu.txt")}`]: () => new Response("{}", { status: 502 }),
    });
    await expect(fetchArchiveBook("https://archive.org/details/countofmontecris01duma")).rejects.toThrow(/didn't send this book's text/);
  });

  it("says so when a scan has no text, and leaves what is not a book to be read as a page", async () => {
    serve({
      "https://archive.org/metadata/plates": () => json({ metadata: { mediatype: "texts", title: "Plates" }, files: [{ name: "plates.pdf", format: "Image Container PDF" }] }),
      "https://archive.org/metadata/concert": () => json({ metadata: { mediatype: "audio", title: "A concert" }, files: [{ name: "notes.txt", format: "Text" }] }),
      "https://archive.org/metadata/missing": () => json({}),
    });
    await expect(fetchArchiveBook("https://archive.org/details/plates")).rejects.toThrow(ReadError);
    expect(await fetchArchiveBook("https://archive.org/details/concert")).toBeNull();
    expect(await fetchArchiveBook("https://archive.org/details/missing")).toBeNull();
    expect(await fetchArchiveBook("https://example.com/details/concert")).toBeNull();
  });

  it("goes through the app's server when the Archive can't be reached directly, and keeps a Latin-1 transcription's accents", async () => {
    const latin1 = new Uint8Array(Array.from(TEXT.replace("The Arrival 1 went on", "Mercédès went on"), (c) => c.charCodeAt(0)));
    const seen = serve({
      [`/api/fetch?url=${encodeURIComponent("https://archive.org/metadata/gut")}`]: () => json({ metadata: { mediatype: "texts", title: "A Tale" }, files: [{ name: "sub dir/tale 1.txt", format: "Text", size: "100" }] }),
      [`/api/fetch?url=${encodeURIComponent("https://archive.org/download/gut/sub%20dir/tale%201.txt")}`]: () => new Response(latin1),
    });
    const page = await fetchArchiveBook("https://archive.org/details/gut");
    expect(page?.text).toContain("Mercédès went on");
    expect(seen).toHaveLength(4);
  });
});
