import type { DocMeta } from "./db";
import { hash } from "./hash";

/**
 * Books published as websites: one page per chapter and a numbered list of them, either on a
 * contents page or in the navigation every chapter carries. Reading that list tells us which
 * book a page belongs to and where it sits, so chapters can be shelved and read in order.
 * A course is read the same way: its page links one numbered deck of slides per lecture.
 */
export interface BookChapter {
  url: string;
  title: string;
  /** The chapter itself, when the whole book came as one text and there is no page of its own to fetch */
  text?: string;
}

/** The sections a chapter's own page lists under it, by the chapter's address. */
export type Sections = ReadonlyMap<string, BookChapter[]>;

export interface BookContents {
  /** The same on every page of the book, so chapters imported at different times still meet */
  id: string;
  title: string;
  chapters: BookChapter[];
  /** Where the fetched page sits in `chapters`; null when it is the contents page itself */
  index: number | null;
  /** A course's parts are lectures, and more of them are posted as it runs */
  kind?: "course";
  /** The page that lists the chapters, when they do not list each other */
  contents?: string;
  /** Catalogue details for chapters that come with their text */
  meta?: DocMeta;
  /** The file the book was chosen as, when it came from the device rather than a link */
  file?: string;
  /**
   * Chapters that may be parts, whose sections are listed only on their own pages. When it names
   * every chapter, none has shown a section yet: the first one tells whether the book is in parts.
   */
  unread?: string[];
}

/** What a book's parts are called. */
export const partNames = (book?: { kind?: "course" } | null) => book?.kind === "course"
  ? { one: "lecture", many: "lectures", One: "Lecture", short: "Lec.", whole: "course" }
  : { one: "chapter", many: "chapters", One: "Chapter", short: "Ch.", whole: "book" };

export const MIN_CHAPTERS = 3;
export const MAX_CHAPTERS = 500;
const MIN_SECTIONS = 2;

const KIND = String.raw`(?:chapter|ch\.?|part|lesson|lecture|lec\.?|section|unit|module|week|day)`;
/** A piece of link text that is only the chapter's number: "01", "Chapter 3", "2." */
const LABEL = new RegExp(String.raw`^(${KIND}\s*)?(\d{1,3})(?:[.:)]|\s*[-–—·•|])?$`, "i");
/** Link text that opens with the number: "1. Getting started", "Chapter 3: Trees", "01 Intro" */
const LEAD = new RegExp(String.raw`^(${KIND}\s*)?(\d{1,3})(?:[.:)]\s*|\s*[-–—:·•|]\s*|\s+)(\S.*)$`, "i");
/** Link text that opens with a chapter's number and a section's: "7.1 · Why indexes exist", "7.10. Bloom filters" */
const SECTION = /^(\d{1,3})\.(\d{1,3})(?:[.:)]\s*|\s*[-–—:·•|]\s*|\s+)(\S.*)$/;
/** A path segment that opens with the number: "08-databases", "chapter-3", "ch03.html" */
const SLUG = /^(?:(?:chapter|ch|part|lesson|lecture|lec|section|unit|module|week|day)[-_]?)?(\d{1,3})(?=$|[-_.])/i;
const CONTENTS = /contents|chapter|toc\b|table-of|sidebar|summary/i;

/** One address per page: no fragment, no trailing slash or index file. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/index\.html?$/i, "/").replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url;
  }
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The link's words, with a space wherever one element ends and the next begins. */
function pieces(a: Element): string[] {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = tidy(node.textContent ?? "");
      if (text) out.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (/^(svg|script|style)$/i.test(el.tagName) || el.getAttribute("aria-hidden") === "true" || /\bsr-only\b|visually-hidden/.test(el.getAttribute("class") ?? "")) return;
    el.childNodes.forEach(walk);
  };
  walk(a);
  return out;
}

interface Entry {
  a: Element;
  key: string;
  url: string;
  n: number;
  title: string;
  /** The number is written in the link, not just in its address */
  written: boolean;
  /** The link says what kind of part it is: "Chapter 3" */
  named: boolean;
  /** The address carries the same number */
  slugged: boolean;
  /** Where a section sits in chapter `n`: the 1 of "7.1" */
  sub?: number;
}

function entryOf(a: Element, page: URL): Entry | null {
  let target: URL;
  try { target = new URL(a.getAttribute("href") ?? "", page); } catch { return null; }
  // A link to a section is not a link to a chapter.
  if (target.origin !== page.origin || !/^https?:$/.test(target.protocol) || target.hash) return null;
  const segment = target.pathname.split("/").filter(Boolean).pop() ?? "";
  const slug = segment.match(SLUG);
  const words = pieces(a);
  const text = tidy(words.join(" "));
  const section = text.match(SECTION);
  if (section) {
    return { a, key: pageKey(target.href), url: target.href, n: Number(section[1]), sub: Number(section[2]), title: section[3].slice(0, 300), written: true, named: false, slugged: false };
  }
  // A card's headline is its title; the rest is a blurb.
  const headline = tidy(a.querySelector("h1,h2,h3,h4,h5,h6,[class*='title'],[class*='Title']")?.textContent ?? "");
  const label = words.length > 1 ? words[0].match(LABEL) : null;
  const lead = label ? null : text.match(LEAD);
  const n = label ? Number(label[2]) : lead ? Number(lead[2]) : slug ? Number(slug[1]) : NaN;
  if (!Number.isFinite(n)) return null;
  const rest = label ? tidy(words.slice(1).join(" ")) : lead ? lead[3] : text;
  const title = (headline && !LABEL.test(headline) ? headline.replace(LEAD, "$3") : rest).slice(0, 300);
  return {
    a, key: pageKey(target.href), url: target.href, n, title,
    written: !!(label || lead), named: !!(label?.[1] || lead?.[1]), slugged: !!slug && Number(slug[1]) === n,
  };
}

/** Runs of links numbered 1, 2, 3… (or from 0) in the order they appear. */
function runs(entries: Entry[]): Entry[][] {
  const found: Entry[][] = [];
  let run: Entry[] = [];
  const close = () => { if (run.length >= MIN_CHAPTERS) found.push(run); run = []; };
  for (const entry of entries) {
    const last = run[run.length - 1];
    if (last && entry.key === last.key) continue;
    if (last && entry.n === last.n + 1 && !run.some((e) => e.key === entry.key)) { run.push(entry); continue; }
    close();
    if (entry.n <= 1) run = [entry];
  }
  close();
  return found;
}

/** Each chapter's sections, numbered 7.1, 7.2, 7.3… in the order they appear, by the chapter's number. */
function sectionRuns(entries: Entry[]): Map<number, Entry[]> {
  const found = new Map<number, Entry[]>();
  let run: Entry[] = [];
  const close = () => {
    if (run.length >= MIN_SECTIONS && run.length > (found.get(run[0].n)?.length ?? 0)) found.set(run[0].n, run);
    run = [];
  };
  for (const entry of entries) {
    const last = run[run.length - 1];
    if (last && entry.key === last.key) continue;
    if (last && entry.n === last.n && entry.sub === last.sub! + 1 && !run.some((e) => e.key === entry.key)) { run.push(entry); continue; }
    close();
    if (entry.sub! <= 1) run = [entry];
  }
  close();
  return found;
}

const relLink = (doc: Document, rel: string, page: URL): string | null => {
  const href = doc.querySelector(`link[rel~="${rel}"][href], a[rel~="${rel}"][href]`)?.getAttribute("href");
  try { return href ? pageKey(new URL(href, page).href) : null; } catch { return null; }
};

/** A numbered list can also be a "most read" box; a book's contents say so in more than one way. */
function looksLikeContents(run: Entry[], doc: Document, page: URL): boolean {
  if (run.filter((e) => e.slugged).length >= run.length * 0.8) return true;
  if (run.filter((e) => e.named).length >= run.length * 0.5) return true;
  const keys = new Set(run.map((e) => e.key));
  if (["next", "prev", "previous"].some((rel) => { const key = relLink(doc, rel, page); return !!key && keys.has(key); })) return true;
  const holder = run[0].a.closest("nav,[role='navigation'],[aria-label],aside,section,ol,ul");
  for (let el: Element | null = holder; el; el = el.parentElement) {
    if (/^nav$/i.test(el.tagName) || el.getAttribute("role") === "navigation") return true;
    if (CONTENTS.test(`${el.getAttribute("class") ?? ""} ${el.id} ${el.getAttribute("aria-label") ?? ""}`)) return true;
  }
  return false;
}

const SEPARATOR = /\s+[·|—–-]\s+|\s*::\s*/;
const NUMBERING = new RegExp(String.raw`^(?:${KIND}\s*)?\d{1,3}$`, "i");

function bookTitle(doc: Document, page: URL, chapterTitle: string | null): string {
  const tag = (selector: string) => tidy(doc.querySelector(selector)?.getAttribute("content") ?? "");
  const parts = (tag('meta[property="og:title"]') || tidy(doc.title)).split(SEPARATOR).map(tidy).filter(Boolean);
  // A chapter's page title ends with the book's; the contents page's begins with it.
  const named = chapterTitle === null ? parts[0] : parts.length >= 2 ? parts[parts.length - 1] : "";
  const fromTitle = named && !NUMBERING.test(named) && named.toLowerCase() !== chapterTitle?.toLowerCase() ? named : "";
  return (tag('meta[property="og:site_name"]') || fromTitle || page.hostname.replace(/^www\./, "")).slice(0, 300);
}

/** A file name that carries its number after a word for the part, anywhere in it: "cs101-lecture03-trees.pdf" */
const NUMBERED_FILE = /(^|[-_.])(lecture|lect|lec|l|class|session|slides?|deck|week|wk|day|chapter|ch|part|unit|module)[-_]?(\d{1,3})(?=$|[-_.])/i;
const COURSE_WORD = /^(?:lecture|lect|lec|l|class|session|slides?|deck|week|wk|day)$/i;
/** A link that names what it leads to by its kind, not its subject: "Slides", "[pdf]" */
const GENERIC = /^[[(]?\s*(?:slides?|pdf|notes?|lecture notes|lecture slides|handouts?|deck|download|link|here|view|materials?|pptx?)\s*[\])]?$/i;
/** A date, a number, or a bare "Week 3": what a schedule puts beside a lecture, not its title */
const NOT_A_TITLE = new RegExp(String.raw`^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\d{1,4}(?:[/.-]\d{1,2}){1,2}$|${KIND}\s*\d{1,3}[.:]?$|[\d\s.,:/-]+$)`, "i");
const PICTOGRAPHS = /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u;

interface Numbered {
  a: Element;
  key: string;
  url: string;
  n: number;
  /** The folder and the words before the number: what the files of one series share */
  series: string;
  course: boolean;
}

function numberedPdf(a: Element, page: URL): Numbered | null {
  let target: URL;
  try { target = new URL(a.getAttribute("href") ?? "", page); } catch { return null; }
  if (!/^https?:$/.test(target.protocol) || !/\.pdf$/i.test(target.pathname)) return null;
  const segments = target.pathname.split("/").filter(Boolean);
  const file = (segments.pop() ?? "").replace(/\.pdf$/i, "");
  const folder = `${target.origin}/${segments.join("/")}`;
  const worded = file.match(NUMBERED_FILE);
  const led = worded ? null : file.match(/^(\d{1,3})(?=$|[-_.])/);
  if (!worded && !led) return null;
  const before = worded ? file.slice(0, worded.index! + worded[1].length + worded[2].length).toLowerCase() : "";
  return {
    a, key: pageKey(target.href), url: target.href, n: Number(worded ? worded[3] : led![1]), series: `${folder}|${before}`,
    course: worded ? COURSE_WORD.test(worded[2]) : /\/(?:slides?|lectures?|lec|decks?|class(?:es)?|sessions?)$/i.test(folder),
  };
}

/** The text of an element, piece by piece, leaving out the links in it: they name files, not lectures. */
function plainPieces(el: Element): string[] {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll("a").forEach((a) => a.remove());
  return pieces(copy);
}

const cleanTitle = (text: string) => tidy(text).replace(PICTOGRAPHS, "").replace(LEAD, (whole, kind, _n, rest) => kind ? rest : whole).slice(0, 300);
const titled = (text: string) => text.length >= 3 && text.length <= 200 && /\p{L}{3}/u.test(text) && !NOT_A_TITLE.test(text) && !GENERIC.test(text) && !/:$/.test(text);

/**
 * What a numbered file is called. Its link often says only "Slides"; the row of the schedule it
 * sits in, which no other file of the series shares, names the lecture.
 */
function partTitle(entry: Numbered, others: Set<Element>): string {
  const own = tidy(pieces(entry.a).join(" "));
  if (own && !GENERIC.test(own) && !LABEL.test(own) && titled(cleanTitle(own))) return cleanTitle(own);
  let row: Element = entry.a;
  for (let up = row.parentElement; up && up.tagName !== "BODY"; up = up.parentElement) {
    if (Array.from(up.querySelectorAll("a[href]")).some((a) => a !== entry.a && others.has(a))) break;
    row = up;
  }
  if (row === entry.a) return "";
  const marked = Array.from(row.querySelectorAll("[class*='title' i],[class*='topic' i],h1,h2,h3,h4,h5,h6,strong,b,dt"))
    .map((el) => cleanTitle(plainPieces(el).join(" "))).find(titled);
  return marked ?? plainPieces(row).map(cleanTitle).find(titled) ?? "";
}

/**
 * A numbered series of PDFs a page links, one per part: a course's decks of slides, wherever they
 * are kept. They are in order by their numbers, which may skip one (a lecture with no slides).
 */
function pdfSeries(doc: Document, page: URL, base: URL): BookContents | null {
  const groups = new Map<string, Numbered[]>();
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const entry = numberedPdf(a, base);
    if (!entry) continue;
    const group = groups.get(entry.series) ?? [];
    // The same file linked twice, or two files with one number, count once.
    if (!group.some((e) => e.key === entry.key || e.n === entry.n)) group.push(entry);
    groups.set(entry.series, group);
  }
  const series = [...groups.values()].map((group) => group.sort((x, y) => x.n - y.n))
    .filter((group) => group.length >= MIN_CHAPTERS && group.length <= MAX_CHAPTERS && group[0].n <= 3
      && group.length >= (group[group.length - 1].n - group[0].n + 1) * 0.5)
    .sort((x, y) => y.length - x.length)[0];
  if (!series) return null;
  const course = series[0].course;
  const others = new Set(series.map((entry) => entry.a));
  const heading = tidy(doc.querySelector("h1")?.textContent ?? "");
  return {
    id: `book:${hash(series[0].key)}`,
    title: (heading && heading.length <= 200 ? heading : bookTitle(doc, page, null)).slice(0, 300),
    chapters: series.map((entry) => ({ url: entry.url, title: partTitle(entry, others) || `${course ? "Lecture" : "Chapter"} ${entry.n}` })),
    index: null,
    ...(course ? { kind: "course" as const } : {}),
    contents: page.href,
  };
}

interface Crumb { key: string; url: string }

/** The trail of pages a page says it sits under, in schema.org BreadcrumbList data: home first, the page itself last. */
function breadcrumbs(doc: Document, page: URL): Crumb[] {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try { data = JSON.parse(script.textContent ?? ""); } catch { continue; }
    const nodes = (Array.isArray(data) ? data : [data]).flatMap((node) => node?.["@graph"] ?? [node]) as Record<string, unknown>[];
    const list = nodes.find((node) => node && ([] as unknown[]).concat(node["@type"]).includes("BreadcrumbList"));
    if (!list || !Array.isArray(list.itemListElement)) continue;
    const items = (list.itemListElement as Record<string, unknown>[])
      .filter((item) => item && typeof item === "object")
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    const trail: Crumb[] = [];
    for (const item of items) {
      const at = item.item;
      const href = typeof at === "string" ? at : at && typeof at === "object" ? (at as Record<string, unknown>)["@id"] ?? (at as Record<string, unknown>).url : item.url;
      if (typeof href !== "string") return [];
      try {
        const url = new URL(href, page);
        if (url.origin !== page.origin) return [];
        trail.push({ key: pageKey(url.href), url: url.href });
      } catch { return []; }
    }
    return trail;
  }
  return [];
}

/** The page the breadcrumbs end on is this one: by its address, or the address it declares as its own. */
function endsHere(trail: Crumb[], doc: Document, page: URL): boolean {
  const last = trail[trail.length - 1]?.key;
  if (!last) return false;
  const canonical = doc.querySelector('link[rel~="canonical"][href]')?.getAttribute("href");
  let declared = "";
  try { declared = canonical ? pageKey(new URL(canonical, page).href) : ""; } catch { /* No declared address. */ }
  return last === pageKey(page.href) || last === declared;
}

const OUTSIDE = "nav,header,footer,aside,[role='navigation']";

/**
 * A track: a page that sits in its site's breadcrumbs and is little more than a heading and one
 * list of the pages it is made of, in order, with no numbers on them. Its pages may live anywhere
 * on the site. A list of dated posts is an archive, not a track.
 */
function trackContents(doc: Document, page: URL, base: URL): BookContents | null {
  const trail = breadcrumbs(doc, page);
  if (trail.length < 2 || !endsHere(trail, doc, page)) return null;
  const above = new Set(trail.map((crumb) => crumb.key));
  const root = doc.querySelector("main") ?? doc.querySelector('[role="main"]') ?? doc.querySelector("article") ?? doc.body;
  const target = (a: Element): string | null => {
    try {
      const url = new URL(a.getAttribute("href") ?? "", base);
      return url.origin === page.origin && /^https?:$/.test(url.protocol) && !url.hash && !above.has(pageKey(url.href)) ? url.href : null;
    } catch { return null; }
  };
  const pageLinks = Array.from(root.querySelectorAll("a[href]")).filter((a) => !a.closest(OUTSIDE) && target(a));
  let best: { a: Element; url: string }[] = [];
  for (const list of Array.from(root.querySelectorAll("ul,ol"))) {
    if (list.closest(OUTSIDE) || list.querySelector("time")) continue;
    const items = Array.from(list.children).filter((li) => li.tagName === "LI");
    const parts = items.flatMap((li) => {
      const a = li.querySelector("a[href]");
      const url = a && target(a);
      return a && url ? [{ a, url }] : [];
    });
    if (parts.length < MIN_CHAPTERS || parts.length > MAX_CHAPTERS || parts.length < items.length) continue;
    if (new Set(parts.map((part) => pageKey(part.url))).size < parts.length) continue;
    // The list is the page: hardly any other links sit beside it.
    const listed = new Set(list.querySelectorAll("a[href]"));
    if (pageLinks.filter((a) => !listed.has(a)).length > parts.length / 3) continue;
    if (parts.length > best.length) best = parts;
  }
  if (!best.length) return null;
  const heading = tidy(root.querySelector("h1")?.textContent ?? "");
  return {
    id: `book:${hash(pageKey(best[0].url))}`,
    title: (heading && heading.length <= 200 ? heading : bookTitle(doc, page, null)).slice(0, 300),
    chapters: best.map((part, i) => ({ url: part.url, title: cleanTitle(pieces(part.a).join(" ")) || `Chapter ${i + 1}` })),
    index: null,
    contents: page.href,
  };
}

/**
 * The page a page's breadcrumbs name as the one just above it, when that is not the site's home
 * page: where a page that does not list its neighbours may be listed with them.
 */
export function breadcrumbParent(doc: Document, url: string): string | null {
  let page: URL;
  try { page = new URL(url); } catch { return null; }
  const trail = breadcrumbs(doc, page);
  return trail.length >= 3 && endsHere(trail, doc, page) ? trail[trail.length - 2].url : null;
}

/** A book read off its contents page, opened at the given page; null when the page is not one of its chapters. */
export function openedAt(book: BookContents, url: string): BookContents | null {
  const key = pageKey(url);
  const index = book.chapters.findIndex((chapter) => pageKey(chapter.url) === key);
  return index < 0 ? null : { ...book, index };
}

/** The page's numbered links: those to chapters, and those to the sections of each chapter. */
function numbered(doc: Document, base: URL): { entries: Entry[]; sections: Map<number, Entry[]> } {
  const all = Array.from(doc.querySelectorAll("a[href]")).flatMap((a) => entryOf(a, base) ?? []);
  return { entries: all.filter((entry) => entry.sub === undefined), sections: sectionRuns(all.filter((entry) => entry.sub !== undefined)) };
}

/**
 * The book a page belongs to, when the page lists its chapters in order. Looks at the whole
 * page, navigation included, so call it before the page is trimmed down to its article.
 */
export function bookContents(doc: Document, url: string): BookContents | null {
  let page: URL;
  try { page = new URL(url); } catch { return null; }
  let base = page;
  try { base = new URL(doc.querySelector("base[href]")?.getAttribute("href") || url, url); } catch { /* Use the page URL. */ }
  const files = pdfSeries(doc, page, base);
  if (files) return files;
  const { entries, sections } = numbered(doc, base);
  const here = pageKey(page.href);
  const listsHere = (e: Entry) => !!sections.get(e.n)?.some((section) => section.key === here);
  const folder = `${page.protocol}//${page.host.toLowerCase()}${page.pathname.replace(/\/index\.html?$/i, "/").replace(/[^/]*$/, "")}`;
  const run = runs(entries)
    .filter((r) => r.length <= MAX_CHAPTERS && (r.some((e) => e.key === here || listsHere(e)) || r.every((e) => `${e.key}/`.startsWith(folder))))
    .filter((r) => looksLikeContents(r, doc, base))
    .sort((a, b) => b.length - a.length)[0];
  if (!run) return trackContents(doc, page, base);
  // The same chapter is often linked twice, from a card and from the navigation: keep the plainest name.
  const names = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.written || !entry.title) continue;
    const known = names.get(entry.key);
    if (!known || entry.title.length < known.length) names.set(entry.key, entry.title);
  }
  const listed = new Set(run.map((entry) => entry.key));
  // A part's sections follow it. A section that is itself a chapter is only a second link to it.
  const under = (entry: Entry) => (sections.get(entry.n) ?? []).filter((section) => !listed.has(section.key));
  const chapters: BookChapter[] = run.flatMap((entry, i) => [
    { url: entry.url, title: names.get(entry.key) || entry.title || `Chapter ${i + 1}` },
    ...under(entry).map((section) => ({ url: section.url, title: section.title })),
  ]);
  const at = chapters.findIndex((chapter) => pageKey(chapter.url) === here);
  const index = at < 0 ? null : at;
  const parts = run.filter((entry) => under(entry).length).length;
  // Navigation that opens only the part being read says nothing of the others' sections.
  const unread = parts === 1 ? run.filter((entry) => !under(entry).length) : parts === 0 && index === null ? run : [];
  return {
    id: `book:${hash(run[0].key)}`,
    title: bookTitle(doc, page, index === null ? null : chapters[index].title),
    chapters,
    index,
    ...(index === null ? { contents: page.href } : {}),
    ...(unread.length ? { unread: unread.map((entry) => entry.url) } : {}),
  };
}

/** The sections a chapter's own page lists under it, each a page to read; none when the chapter is not a part. */
export function sectionsOf(doc: Document, url: string): BookChapter[] {
  let page: URL;
  try { page = new URL(url); } catch { return []; }
  let base = page;
  try { base = new URL(doc.querySelector("base[href]")?.getAttribute("href") || url, url); } catch { /* Use the page URL. */ }
  const { entries, sections } = numbered(doc, base);
  const here = pageKey(page.href);
  const chapter = entries.find((entry) => entry.key === here && entry.written);
  return (chapter ? sections.get(chapter.n) ?? [] : []).filter((section) => section.key !== here).map((section) => ({ url: section.url, title: section.title }));
}

/**
 * A book in parts, with the sections read off the parts' pages put after their parts. Left as it
 * was when that would make it longer than a book gets.
 */
export function withSections(book: BookContents, found: Sections): BookContents {
  const { unread: _, ...rest } = book;
  const keys = new Set(book.chapters.map((chapter) => pageKey(chapter.url)));
  const chapters = book.chapters.flatMap((chapter) => {
    const added = (found.get(pageKey(chapter.url)) ?? []).filter((section) => !keys.has(pageKey(section.url)));
    for (const section of added) keys.add(pageKey(section.url));
    return [chapter, ...added];
  });
  if (chapters.length === book.chapters.length || chapters.length > MAX_CHAPTERS) return rest;
  const opened = book.index === null ? null : book.chapters[book.index];
  return { ...rest, chapters, index: opened ? chapters.indexOf(opened) : null };
}
