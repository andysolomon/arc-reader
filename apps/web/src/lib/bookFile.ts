import { strFromU8, unzipSync } from "fflate";
import { MAX_CHAPTERS, type BookContents } from "./book";
import { decodeText, splitBook, type BookPart } from "./bookText";
import type { DocMeta } from "./db";
import { MAX_BOOK_BYTES, isEpubFile } from "./epubType";
import { htmlToText, type Fetched } from "./fetchUrl";
import { hash } from "./hash";
import { ReadError } from "./readError";

/**
 * Whole books chosen from the device: a plain-text file (a Project Gutenberg download, say) or
 * an EPUB. Either becomes a book with chapters, like one imported from the Internet Archive.
 * A plain text is cut where its chapter headings are; an EPUB already says where its chapters
 * are, in its table of contents, and is cut there.
 */

export { MAX_BOOK_BYTES };
/** Less text than this under a heading is a divider ("Part One") or an epigraph, and goes with the chapter after it */
const MIN_CHAPTER_CHARS = 400;
/** One "chapter" longer than this is a whole book in one file, and is cut by its headings instead */
const WHOLE_BOOK_CHARS = 60_000;

export const DRM = "This EPUB is copy-protected (DRM), so its text can't be read. Books bought from Kindle, Apple Books or Kobo usually are; a DRM-free copy imports fine.";
const NOT_EPUB = "That file isn't an EPUB the app can open";
const NO_TEXT = "That book has no text to read";
const TOO_LARGE = "That file is too large to import as one book";

/** Pages that are about the book rather than in it, cut out by their titles */
const FRONT = /^(?:cover|cover page|title|title page|half title|copyright|copyright page|imprint|colophon|contents|table of contents|toc|uncopyright|also by .*|other books by .*|.*project gutenberg.*)$/i;
/** Headings that divide a book into chapters below them */
const DIVISION = /^(?:part|book|volume|vol\.)\b/i;

/** Where a Project Gutenberg transcription's licence begins */
const GUTENBERG_END = /\*{3} ?END OF (?:THE|THIS) PROJECT GUTENBERG/i;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** "animal_farm.txt" → "animal farm" */
const fromFileName = (name: string) => tidy(name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ")) || "Untitled book";

/**
 * The book as the app reads any page: its first chapter, with the others in `book`. The id
 * comes from the title, author and chapter list, not the file's name, so the same book chosen
 * again, or on another device, meets the copy already shelved instead of being added twice;
 * another edition, cut into different chapters, gets a shelf of its own. `shown` is the title
 * with its subtitle, which names the book on the shelf without changing which book it is.
 */
function asBook(file: string, title: string, meta: DocMeta, parts: BookPart[], shown = title): Fetched {
  if (!parts.length) throw new ReadError(NO_TEXT);
  const book: BookContents | undefined = parts.length > 1 ? {
    id: `book:${hash(`file/${title.toLowerCase()}/${(meta.author ?? "").toLowerCase()}/${parts.map((part) => part.title).join("\n")}`)}`,
    title: shown,
    chapters: parts.slice(0, MAX_CHAPTERS).map((part) => ({ url: "", title: part.title, text: part.text })),
    index: 0,
    meta,
    file,
  } : undefined;
  return { title: shown, text: parts[0].text, domain: file, meta, links: [], ...(book ? { book } : {}) };
}

/** Project Gutenberg's header names the book: "Title: Animal Farm", "Author: …", "Release date: …". */
function gutenbergRecord(raw: string): { title?: string; meta: DocMeta } {
  const head = raw.slice(0, 6000);
  const field = (name: string) => head.match(new RegExp(`^${name}:[ \\t]*(.+(?:\\r?\\n[ \\t]+.+)*)`, "im"))?.[1];
  const title = field("Title");
  const author = field("Author");
  const published = field("Original publication")?.match(/\b\d{4}\b/)?.[0];
  return { ...(title ? { title: tidy(title) } : {}), meta: { ...(author ? { author: tidy(author) } : {}), ...(published ? { published } : {}) } };
}

/**
 * A plain-text file as a book, when its chapters can be found; null when it is just a text,
 * which is then opened like pasted text.
 */
export function textBook(name: string, raw: string): Fetched | null {
  const parts = splitBook(raw);
  if (parts.length < 2) return null;
  const { title, meta } = gutenbergRecord(raw);
  return asBook(name, title ?? fromFileName(name), meta, parts);
}

interface TocEntry {
  title: string;
  /** Path inside the archive */
  path: string;
  /** The element the chapter starts at, when it starts partway through its file */
  anchor?: string;
  children: TocEntry[];
}

/** Where a chapter starts, and whether it is one to read */
interface Cut {
  title: string;
  spine: number;
  anchor?: string;
  skip: boolean;
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
const parsed = (doc: Document) => !doc.getElementsByTagName("parsererror").length;
const byName = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS("*", name));
const firstText = (root: Document | Element, name: string) => tidy(byName(root, name)[0]?.textContent ?? "");
const OPS = "http://www.idpf.org/2007/ops";
const classed = (el: Element, name: string) => (el.getAttribute("class") ?? "").split(/\s+/).includes(name);
/** A subtitle longer than this is a blurb */
const MAX_SUBTITLE_CHARS = 200;
/** The title page is among the first few files */
const TITLE_PAGE_FILES = 3;

/**
 * The titles a book's record gives: its own, and a subtitle when the record marks one. The
 * volumes of a set often share a title and differ only below it.
 */
function recordTitles(metadata: Element): { title: string; subtitle: string } {
  const titles = byName(metadata, "title");
  const kind = (title: Element) => tidy(byName(metadata, "meta").find((m) => m.getAttribute("property") === "title-type" && m.getAttribute("refines") === `#${title.getAttribute("id")}`)?.textContent ?? "");
  const main = titles.find((title) => kind(title) === "main") ?? titles[0];
  const sub = titles.find((title) => title !== main && kind(title) === "subtitle");
  return { title: tidy(main?.textContent ?? ""), subtitle: tidy(sub?.textContent ?? "") };
}

/** `href` resolved against the file it appears in, as a path inside the archive, and its fragment. */
function resolve(from: string, href: string): { path: string; anchor?: string } {
  const [rawPath, anchor] = href.split("#");
  const parts = from.split("/").slice(0, -1);
  if (rawPath) {
    for (const part of decodeURIComponent(rawPath).split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
  } else parts.push(from.split("/").pop()!);
  return { path: parts.join("/"), ...(anchor ? { anchor: decodeURIComponent(anchor) } : {}) };
}

/** An EPUB 3 navigation document's table of contents */
function navToc(path: string, doc: Document): TocEntry[] {
  const navs = byName(doc, "nav");
  const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute("epub:type") ?? n.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "")) ?? navs[0];
  const list = nav ? byName(nav, "ol")[0] : undefined;
  const entries = (ol: Element): TocEntry[] => Array.from(ol.children).flatMap((li) => {
    const link = Array.from(li.children).find((c) => c.localName === "a" || c.localName === "span");
    const sub = Array.from(li.children).find((c) => c.localName === "ol");
    const children = sub ? entries(sub) : [];
    const href = link?.getAttribute("href");
    if (!href) return children;
    return [{ title: tidy(link!.textContent ?? ""), ...resolve(path, href), children }];
  });
  return list ? entries(list) : [];
}

/** An EPUB 2 NCX table of contents */
function ncxToc(path: string, doc: Document): TocEntry[] {
  const map = byName(doc, "navMap")[0];
  const entries = (parent: Element): TocEntry[] => Array.from(parent.children).filter((c) => c.localName === "navPoint").flatMap((point) => {
    const label = Array.from(point.children).find((c) => c.localName === "navLabel");
    const src = Array.from(point.children).find((c) => c.localName === "content")?.getAttribute("src");
    const children = entries(point);
    if (!src) return children;
    return [{ title: tidy(label?.textContent ?? ""), ...resolve(path, src), children }];
  });
  return map ? entries(map) : [];
}

/**
 * The entries to cut at. Usually the top level of the contents; a level that only divides the
 * book (Part One, Part Two) or holds fewer than three entries is opened to the chapters below.
 */
function cutEntries(entries: TocEntry[]): TocEntry[] {
  const open = entries.length < 3;
  return entries.flatMap((entry) => entry.children.length && (open || DIVISION.test(entry.title)) ? [entry, ...cutEntries(entry.children)] : [entry]);
}

/** Chapter text keeps its heading, and gets one from the contents when the page has none. */
function withHeading(title: string, text: string): string {
  // "I." above "## Introduction" is the page's own heading, set in two lines.
  const own = text.split("\n\n", 3).some((block) => /^#{1,6} /.test(block));
  return own || !title ? text : `# ${title}\n\n${text}`;
}

/** Text under the headings, to tell a chapter from a divider */
const bodyLength = (text: string) => text.split("\n\n").filter((block) => !/^#{1,6} /.test(block)).join(" ").length;

/** Short pieces join the chapter after them; a short last piece joins the one before. */
function mergeShort(parts: BookPart[]): BookPart[] {
  const out: BookPart[] = [];
  let carry = "";
  for (const part of parts) {
    const text = carry ? `${carry}\n\n${part.text}` : part.text;
    if (bodyLength(text) < MIN_CHAPTER_CHARS) { carry = text; continue; }
    out.push({ title: part.title, text });
    carry = "";
  }
  if (carry) {
    if (out.length) out[out.length - 1].text += `\n\n${carry}`;
    else if (bodyLength(carry)) out.push({ title: parts[parts.length - 1]?.title ?? "", text: carry });
  }
  return out;
}

/** A content file, with each node's place in document order: where it starts and its last descendant */
interface Page {
  doc: Document;
  body: Element;
  span: Map<Node, [first: number, last: number]>;
}

function spans(root: Node): Map<Node, [number, number]> {
  const span = new Map<Node, [number, number]>();
  let n = 0;
  const visit = (node: Node) => {
    const first = n++;
    node.childNodes.forEach(visit);
    span.set(node, [first, n - 1]);
  };
  visit(root);
  return span;
}

/** A copy of what lies from node number `start` up to (not including) node number `end`, keeping the elements around it. */
function slice(node: Node, start: number, end: number, span: Map<Node, [number, number]>, into: Document): Node | null {
  const [first, last] = span.get(node)!;
  if (last < start || first >= end) return null;
  if (first >= start && last < end) return into.importNode(node, true);
  const copy = into.importNode(node, false);
  node.childNodes.forEach((child) => {
    const part = slice(child, start, end, span, into);
    if (part) copy.appendChild(part);
  });
  return copy;
}

/** The HTML of a chapter: content from each cut to the next, across files as needed. */
class Chapters {
  private out = new DOMParser().parseFromString("<!doctype html><html><head></head><body></body></html>", "text/html");
  private docs = new Map<number, Page | null>();

  constructor(private spine: string[], private read: (path: string) => string | undefined) {}

  private page(index: number): Page | null {
    if (this.docs.has(index)) return this.docs.get(index)!;
    const text = this.read(this.spine[index]);
    let page: Page | null = null;
    if (text !== undefined) {
      // XHTML as XML, where self-closed tags mean what they say; as HTML when it isn't well formed.
      let doc = new DOMParser().parseFromString(text, "application/xhtml+xml");
      if (!parsed(doc) || !byName(doc, "body").length) doc = new DOMParser().parseFromString(text, "text/html");
      const body = byName(doc, "body")[0];
      if (body) page = { doc, body, span: spans(body) };
    }
    this.docs.set(index, page);
    return page;
  }

  /** The text from `from` up to (not including) `to`, or to the end of the book */
  text(from: Cut, to: Cut | undefined): string {
    const body = this.out.body;
    body.replaceChildren();
    const last = to ? (to.anchor ? to.spine : to.spine - 1) : this.spine.length - 1;
    for (let i = from.spine; i <= last; i++) {
      const page = this.page(i);
      if (!page) continue;
      const at = (anchor?: string) => (anchor ? page.span.get(page.doc.getElementById(anchor)!)?.[0] : undefined);
      const start = (i === from.spine ? at(from.anchor) : undefined) ?? 0;
      const end = (to && i === to.spine ? at(to.anchor) : undefined) ?? Infinity;
      const copy = slice(page.body, start, end, page.span, this.out);
      if (copy) body.append(...Array.from(copy.childNodes));
    }
    // A chapter's title is often in a <header>, which pages drop as site furniture; here it is the book.
    body.querySelectorAll("header,footer,article,main,section").forEach((el) => {
      const div = this.out.createElement("div");
      div.append(...Array.from(el.childNodes));
      el.replaceWith(div);
    });
    // Pictures live inside the file, where the reader's image descriptions can't reach them;
    // Project Gutenberg's header and licence are about the transcription, not the book.
    body.querySelectorAll("img,svg,image,picture,#pg-header,#pg-footer,.pg-boilerplate").forEach((el) => el.remove());
    const text = htmlToText(this.out.documentElement.outerHTML, "").text;
    return text.split(GUTENBERG_END)[0].trim();
  }

  /** The subtitle a title page sets under the title, when this file is the title page and marks one */
  subtitle(index: number): string {
    const page = this.page(index);
    if (!page) return "";
    const marked = (el: Element) => /\btitlepage\b/.test(`${el.getAttribute("epub:type") ?? el.getAttributeNS(OPS, "type") ?? ""} ${el.getAttribute("class") ?? ""}`);
    const titlePage = [page.body, ...byName(page.body, "*")].find(marked);
    const subtitle = titlePage && byName(titlePage, "*").find((el) => classed(el, "subtitle"));
    return tidy(subtitle?.textContent ?? "");
  }

  /** The first heading in a file, to name a chapter when the book has no contents */
  heading(index: number): string {
    const page = this.page(index);
    // Not the page's <title>, which is often the book's title on every page.
    return page ? tidy(["h1", "h2", "h3"].map((h) => byName(page.body, h)[0]?.textContent ?? "").find((t) => tidy(t)) ?? "") : "";
  }
}

/** An EPUB's chapters, in reading order. */
export function epubBook(name: string, bytes: Uint8Array): Fetched {
  let files: Record<string, Uint8Array>;
  try {
    // Pictures, fonts and sound are most of an EPUB's bytes, and none of them is read.
    files = unzipSync(bytes, { filter: (file) => !/\.(?:jpe?g|png|gif|webp|svg|bmp|tiff?|ttf|otf|woff2?|mp3|m4a|mp4|ogg|opus|wav)$/i.test(file.name) });
  } catch {
    throw new ReadError(NOT_EPUB);
  }
  const read = (path: string) => (files[path] ? decodeText(files[path]) : undefined);

  // Adobe and Apple DRM encrypt the chapters themselves; fonts alone are only obfuscated.
  const encryption = read("META-INF/encryption.xml");
  if (files["META-INF/rights.xml"] || files["META-INF/sinf.xml"] || (encryption && /URI="[^"]+\.x?html?"/i.test(encryption))) throw new ReadError(DRM);

  const container = read("META-INF/container.xml");
  const opfPath = container ? byName(xml(container), "rootfile")[0]?.getAttribute("full-path") : null;
  const opfText = opfPath ? read(opfPath) : undefined;
  if (!opfPath || !opfText) throw new ReadError(NOT_EPUB);
  const opf = xml(opfText);
  if (!parsed(opf)) throw new ReadError(NOT_EPUB);

  const manifest = new Map(byName(opf, "item").map((item) => [item.getAttribute("id") ?? "", {
    path: resolve(opfPath, item.getAttribute("href") ?? "").path,
    type: item.getAttribute("media-type") ?? "",
    properties: item.getAttribute("properties") ?? "",
  }]));
  const spineEl = byName(opf, "spine")[0];
  const spine = byName(opf, "itemref")
    .filter((ref) => ref.getAttribute("linear") !== "no")
    .flatMap((ref) => {
      const item = manifest.get(ref.getAttribute("idref") ?? "");
      return item && /html/.test(item.type) ? [item.path] : [];
    });
  if (!spine.length) throw new ReadError(NO_TEXT);

  const metadata = byName(opf, "metadata")[0] ?? opf.documentElement;
  const record = recordTitles(metadata);
  const title = record.title || fromFileName(name);
  const creators = byName(metadata, "creator").map((c) => tidy(c.textContent ?? "")).filter(Boolean).slice(0, 3);
  const published = firstText(metadata, "date").slice(0, 10);
  const description = tidy(firstText(metadata, "description").replace(/<[^>]+>/g, " ")).slice(0, 2000);
  const publisher = firstText(metadata, "publisher");
  const meta: DocMeta = {
    ...(creators.length ? { author: creators.join(", ") } : {}),
    ...(published ? { published } : {}),
    ...(publisher ? { site: publisher } : {}),
    ...(description ? { description } : {}),
  };

  // The contents: EPUB 3's navigation document, else EPUB 2's NCX.
  const navItem = [...manifest.values()].find((item) => /\bnav\b/.test(item.properties));
  const ncxItem = manifest.get(spineEl?.getAttribute("toc") ?? "") ?? [...manifest.values()].find((item) => item.type === "application/x-dtbncx+xml");
  const navText = navItem && read(navItem.path);
  const ncxText = ncxItem && read(ncxItem.path);
  let toc = navText ? navToc(navItem!.path, new DOMParser().parseFromString(navText, parsed(xml(navText)) ? "application/xhtml+xml" : "text/html")) : [];
  if (!toc.length && ncxText) toc = ncxToc(ncxItem!.path, xml(ncxText));

  const where = new Map(spine.map((path, index) => [path, index]));
  const seen = new Set<string>();
  const cuts: Cut[] = cutEntries(toc).flatMap((entry) => {
    const spineIndex = where.get(entry.path);
    const key = `${entry.path}#${entry.anchor ?? ""}`;
    if (spineIndex === undefined || seen.has(key)) return [];
    seen.add(key);
    return [{ title: entry.title, spine: spineIndex, ...(entry.anchor ? { anchor: entry.anchor } : {}), skip: FRONT.test(entry.title) }];
  });
  // Contents that run backwards can't be cut in order; the files themselves are the chapters then.
  const ordered = cuts.every((cut, i) => i === 0 || cut.spine >= cuts[i - 1].spine);

  const chapters = new Chapters(spine, read);
  const subtitle = record.subtitle || spine.slice(0, TITLE_PAGE_FILES).map((_, i) => chapters.subtitle(i)).find(Boolean) || "";
  const shown = subtitle && subtitle.length <= MAX_SUBTITLE_CHARS && !title.toLowerCase().includes(subtitle.toLowerCase()) ? `${title}: ${subtitle}` : title;
  let parts: BookPart[];
  if (ordered && cuts.filter((cut) => !cut.skip).length >= 2) {
    parts = cuts.flatMap((cut, i) => {
      if (cut.skip) return [];
      const text = chapters.text(cut, cuts[i + 1]);
      return text ? [{ title: cut.title, text: withHeading(cut.title, text) }] : [];
    });
  } else {
    parts = spine.flatMap((_, i) => {
      const heading = chapters.heading(i);
      if (FRONT.test(heading)) return [];
      const text = chapters.text({ title: heading, spine: i, skip: false }, { title: "", spine: i + 1, skip: false });
      return text ? [{ title: heading, text: withHeading(heading, text) }] : [];
    });
  }
  parts = mergeShort(parts).map((part, i) => ({ ...part, title: part.title || `Part ${i + 1}` }));
  // A book in one file, or with no contents to cut it by, is cut where its chapter headings are.
  if (parts.length === 1 && parts[0].text.length > WHOLE_BOOK_CHARS) {
    const split = splitBook(parts[0].text.replace(/^#{1,6} /gm, ""));
    if (split.length > 1) parts = split;
  }
  return asBook(name, title, meta, parts, shown);
}

const isEpub = (file: File) => file.type === "application/epub+zip" || /\.epub$/i.test(file.name);

/**
 * A book file chosen from the device. An EPUB is always read as a book; a text file is a book
 * when its chapters can be found, and null otherwise, to be opened like pasted text.
 */
export async function readBookFile(file: File): Promise<Fetched | null> {
  if (file.size > MAX_BOOK_BYTES) throw new ReadError(TOO_LARGE);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return isEpub(file) ? epubBook(file.name, bytes) : textBook(file.name, decodeText(bytes));
}

export const isBookFile = (file: File) => isEpub(file) || file.type === "text/plain" || /\.txt$/i.test(file.name);
