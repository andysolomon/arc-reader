// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { DRM, epubBook, textBook } from "./bookFile";
import { isEpubFile } from "./epubType";
import { ReadError } from "./readError";

const para = (about: string) => Array.from({ length: 5 }, (_, i) => `${about} went on in sentence ${i + 1}, long enough that the paragraph reads as prose.`).join(" ");
const prose = (about: string, n = 3) => Array.from({ length: n }, (_, i) => `<p>${para(`${about} ${i + 1}`)}</p>`).join("\n");
const xhtml = (body: string, title = "Page") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head>
<body>${body}</body></html>`;

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function epub(files: Record<string, string>): Uint8Array {
  return zipSync({ mimetype: strToU8("application/epub+zip"), "META-INF/container.xml": strToU8(CONTAINER), ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])) });
}

function opf(items: [id: string, href: string, extra?: string][], spine: string[], meta = "", toc = "") {
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Farmyard</dc:title><dc:creator>Jane Example</dc:creator><dc:date>1921-05-01</dc:date>${meta}</metadata>
<manifest>${items.map(([id, href, extra = ""]) => `<item id="${id}" href="${href}" media-type="${href.endsWith(".ncx") ? "application/x-dtbncx+xml" : "application/xhtml+xml"}" ${extra}/>`).join("")}</manifest>
<spine ${toc}>${spine.map((id) => `<itemref idref="${id}"/>`).join("")}</spine>
</package>`;
}

/** An EPUB 3 book: cover and copyright pages, a part divider, chapters in their own files and two sharing one. */
const THREE = epub({
  "OEBPS/content.opf": opf(
    [["nav", "nav.xhtml", 'properties="nav"'], ["cover", "text/cover.xhtml"], ["copy", "text/copyright.xhtml"], ["part1", "text/part1.xhtml"], ["c1", "text/ch1.xhtml"], ["c23", "text/ch2-3.xhtml"], ["pg", "text/licence.xhtml"]],
    ["cover", "copy", "part1", "c1", "c23", "pg"],
  ),
  "OEBPS/nav.xhtml": xhtml(`<nav epub:type="toc"><ol>
    <li><a href="text/cover.xhtml">Cover</a></li>
    <li><a href="text/copyright.xhtml">Copyright</a></li>
    <li><a href="text/part1.xhtml">Part One</a><ol>
      <li><a href="text/ch1.xhtml">Chapter 1: The Meeting</a></li>
      <li><a href="text/ch2-3.xhtml#c2">Chapter 2: The Song</a></li>
      <li><a href="text/ch2-3.xhtml#c3">Chapter 3: The Harvest</a></li>
    </ol></li>
    <li><a href="text/licence.xhtml">The Full Project Gutenberg License</a></li>
  </ol></nav>`),
  "OEBPS/text/cover.xhtml": xhtml(`<img src="../images/cover.jpg" alt="Cover"/>`),
  "OEBPS/text/copyright.xhtml": xhtml(`<p>Copyright notice, all rights reserved.</p>`),
  "OEBPS/text/part1.xhtml": xhtml(`<h1>Part One</h1>`),
  "OEBPS/text/ch1.xhtml": xhtml(`<section><header><h2>Chapter 1</h2><p>The Meeting</p></header>${prose("Meeting")}<img src="../images/barn.jpg" alt="The barn"/></section>`),
  "OEBPS/text/ch2-3.xhtml": xhtml(`<section id="c2"><h2>Chapter 2</h2>${prose("Song")}</section><section id="c3"><h2>Chapter 3</h2>${prose("Harvest")}<p>*** END OF THE PROJECT GUTENBERG EBOOK THE FARMYARD ***</p><p>Licence text that is not the book.</p></section>`),
  "OEBPS/text/licence.xhtml": xhtml(`<p>${para("Licence")}</p>`),
});

describe("EPUB books", () => {
  it("cuts the book at its table of contents, leaving out the pages about the book", () => {
    const f = epubBook("farmyard.epub", THREE);
    expect(f.title).toBe("The Farmyard");
    expect(f.domain).toBe("farmyard.epub");
    expect(f.meta).toEqual({ author: "Jane Example", published: "1921-05-01" });
    const chapters = f.book!.chapters;
    expect(chapters.map((c) => c.title)).toEqual(["Chapter 1: The Meeting", "Chapter 2: The Song", "Chapter 3: The Harvest"]);
    expect(f.book).toMatchObject({ title: "The Farmyard", index: 0, file: "farmyard.epub" });
    expect(f.text).toBe(chapters[0].text);
  });

  it("keeps each chapter's own text and heading, and a part divider with its first chapter", () => {
    const [one, two, three] = epubBook("farmyard.epub", THREE).book!.chapters.map((c) => c.text!);
    expect(one.startsWith("# Part One\n\n## Chapter 1\n\nThe Meeting")).toBe(true);
    expect(one).toContain("Meeting 3 went on");
    expect(one).not.toContain("Song");
    expect(two.startsWith("## Chapter 2")).toBe(true);
    expect(two).not.toContain("Harvest");
    expect(three).toContain("Harvest 3 went on");
    for (const text of [one, two, three]) expect(text).not.toMatch(/Copyright|Licence|GUTENBERG|cover\.jpg|barn/);
  });

  it("gives the same book the same id, so choosing it again doesn't shelve it twice", () => {
    expect(epubBook("a.epub", THREE).book!.id).toBe(epubBook("renamed.epub", THREE).book!.id);
    const text = [1, 2, 3].map((n) => `CHAPTER ${n}\n\n${Array.from({ length: 5 }, (_, i) => `<p>${para(`Part ${n}.${i}`)}</p>`).join("")}`).join("");
    const edition = textBook("farmyard.txt", "Title: The Farmyard\nAuthor: Jane Example\n\n" + text.replace(/<\/?p>/g, "\n\n"))!;
    expect(edition.book!.id).not.toBe(epubBook("a.epub", THREE).book!.id);
  });

  it("reads an EPUB 2 book's NCX contents", () => {
    const book = epub({
      "OEBPS/content.opf": opf([["ncx", "toc.ncx"], ["a", "a.html"], ["b", "b.html"], ["c", "c.html"]], ["a", "b", "c"], "", 'toc="ncx"'),
      "OEBPS/toc.ncx": `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
        <navPoint id="1"><navLabel><text>Title Page</text></navLabel><content src="a.html"/></navPoint>
        <navPoint id="2"><navLabel><text>I. Old Major</text></navLabel><content src="b.html"/></navPoint>
        <navPoint id="3"><navLabel><text>II. The Rebellion</text></navLabel><content src="c.html"/></navPoint>
      </navMap></ncx>`,
      "OEBPS/a.html": xhtml(`<h1>The Farmyard</h1><p>by Jane Example</p>`),
      "OEBPS/b.html": xhtml(`<h2>I</h2>${prose("Major")}`),
      "OEBPS/c.html": xhtml(`<h2>II</h2>${prose("Rebellion")}`),
    });
    expect(epubBook("x.epub", book).book!.chapters.map((c) => c.title)).toEqual(["I. Old Major", "II. The Rebellion"]);
  });

  it("uses the files as chapters when there are no contents, named by their headings", () => {
    const book = epub({
      "OEBPS/content.opf": opf([["a", "a.xhtml"], ["b", "b.xhtml"], ["c", "c.xhtml"]], ["a", "b", "c"]),
      "OEBPS/a.xhtml": xhtml(`<h1>Contents</h1><p>One, Two</p>`),
      "OEBPS/b.xhtml": xhtml(`<h1>One</h1>${prose("One")}`),
      "OEBPS/c.xhtml": xhtml(`${prose("Two")}`),
    });
    const chapters = epubBook("x.epub", book).book!.chapters;
    expect(chapters.map((c) => c.title)).toEqual(["One", "Part 2"]);
    expect(chapters[1]!.text!.startsWith("Two 1 went on")).toBe(true);
  });

  it("refuses copy-protected books and files that aren't EPUBs", () => {
    const locked = epub({
      "OEBPS/content.opf": opf([["a", "a.xhtml"]], ["a"]),
      "OEBPS/a.xhtml": "encrypted bytes",
      "META-INF/encryption.xml": `<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/a.xhtml"/></CipherData></EncryptedData></encryption>`,
    });
    expect(() => epubBook("x.epub", locked)).toThrow(DRM);
    expect(() => epubBook("x.epub", strToU8("not a zip"))).toThrow(ReadError);
  });

  /** One volume of a set: every volume has the set's title, and its own only on the title page. */
  const volume = (n: number, name: string, meta = "") => epub({
    "OEBPS/content.opf": opf([["nav", "nav.xhtml", 'properties="nav"'], ["title", "title.xhtml"], ["c1", "c1.xhtml"], ["c2", "c2.xhtml"]], ["title", "c1", "c2"], meta),
    "OEBPS/nav.xhtml": xhtml(`<nav epub:type="toc"><ol><li><a href="c1.xhtml">${name} begins</a></li><li><a href="c2.xhtml">${name} ends</a></li></ol></nav>`),
    "OEBPS/title.xhtml": xhtml(`<section epub:type="titlepage" class="titlepage"><h1 class="title">The Farmyard</h1><p class="subtitle">Volume ${n} — ${name}</p><p class="author">Jane Example</p></section>`),
    "OEBPS/c1.xhtml": xhtml(`<h1>${name} begins</h1>${prose(`${name} one`)}`),
    "OEBPS/c2.xhtml": xhtml(`<h1>${name} ends</h1>${prose(`${name} two`)}`),
  });

  it("names the volumes of a set apart by the subtitle on each one's title page", () => {
    const one = epubBook("vol1.epub", volume(1, "Spring"));
    const two = epubBook("vol2.epub", volume(2, "Harvest"));
    expect([one.book!.title, two.book!.title]).toEqual(["The Farmyard: Volume 1 — Spring", "The Farmyard: Volume 2 — Harvest"]);
    expect(one.title).toBe(one.book!.title);
    expect(one.book!.id).not.toBe(two.book!.id);
    // The title page is still not a chapter.
    expect(one.book!.chapters.map((c) => c.title)).toEqual(["Spring begins", "Spring ends"]);
    // A page that merely has a subtitle class somewhere is not a title page.
    expect(epubBook("farmyard.epub", THREE).title).toBe("The Farmyard");
  });

  it("takes a subtitle the book's record marks as one, without becoming a different book", () => {
    const marked = `<dc:title id="t2">A Fable</dc:title><meta refines="#t2" property="title-type">subtitle</meta>`;
    const bare = volume(1, "Spring").slice();
    const withRecord = epubBook("vol1.epub", volume(1, "Spring", marked));
    expect(withRecord.title).toBe("The Farmyard: A Fable");
    expect(withRecord.book!.id).toBe(epubBook("vol1.epub", bare).book!.id);
  });

  it("knows an EPUB by its bytes, whatever it is served as", () => {
    // As the format asks: the type comes first in the archive, and is stored as written.
    const strict = zipSync({ mimetype: [strToU8("application/epub+zip"), { level: 0 }], "META-INF/container.xml": strToU8(CONTAINER) });
    expect(isEpubFile(strict, "application/octet-stream", "download")).toBe(true);
    const loose = zipSync({ "META-INF/container.xml": strToU8(CONTAINER), mimetype: strToU8("application/epub+zip") });
    expect(isEpubFile(loose)).toBe(false);
    expect(isEpubFile(loose, "", "book.epub")).toBe(true);
    expect(isEpubFile(loose, "application/epub+zip")).toBe(true);
    expect(isEpubFile(zipSync({ "a.txt": strToU8("some text") }), "application/zip", "notes.zip")).toBe(false);
    expect(isEpubFile(strToU8("<html>book.epub</html>"), "application/epub+zip", "book.epub")).toBe(false);
  });
});

describe("plain-text books", () => {
  const chapter = (n: string, title: string) => [`CHAPTER ${n}`, title, ...["a", "b", "c", "d", "e"].map((p) => para(`${title} ${p}`))].join("\n\n");
  const GUTENBERG = [
    "The Project Gutenberg eBook of The Farmyard",
    "Title: The Farmyard\n\nAuthor: Jane Example\n\nRelease date: May 1, 2024 [eBook #99999]",
    "*** START OF THE PROJECT GUTENBERG EBOOK THE FARMYARD ***",
    chapter("I", "Old Major"), chapter("II", "The Rebellion"), chapter("III", "The Harvest"),
    "*** END OF THE PROJECT GUTENBERG EBOOK THE FARMYARD ***",
  ].join("\n\n");

  it("takes the title and author from a Project Gutenberg header and cuts at the chapters", () => {
    const f = textBook("pg99999.txt", GUTENBERG)!;
    expect(f.title).toBe("The Farmyard");
    expect(f.meta.author).toBe("Jane Example");
    expect(f.book!.chapters).toHaveLength(3);
    expect(f.book!.file).toBe("pg99999.txt");
  });

  it("names a book without a header after its file", () => {
    const f = textBook("the_farmyard.txt", [chapter("I", "Old Major"), chapter("II", "The Rebellion"), chapter("III", "The Harvest")].join("\n\n"))!;
    expect(f.title).toBe("the farmyard");
  });

  it("leaves a text without chapters as a text", () => {
    expect(textBook("note.txt", "A short note to read.")).toBeNull();
  });
});
