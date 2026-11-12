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
}

/** What a book's parts are called. */
export const partNames = (book?: { kind?: "course" } | null) => book?.kind === "course"
  ? { one: "lecture", many: "lectures", One: "Lecture", short: "Lec.", whole: "course" }
  : { one: "chapter", many: "chapters", One: "Chapter", short: "Ch.", whole: "book" };

export const MIN_CHAPTERS = 3;
export const MAX_CHAPTERS = 500;

const KIND = String.raw`(?:chapter|ch\.?|part|lesson|lecture|lec\.?|section|unit|module|week|day)`;
/** A piece of link text that is only the chapter's number: "01", "Chapter 3", "2." */
const LABEL = new RegExp(String.raw`^(${KIND}\s*)?(\d{1,3})(?:[.:)]|\s*[-–—])?$`, "i");
/** Link text that opens with the number: "1. Getting started", "Chapter 3: Trees", "01 Intro" */
const LEAD = new RegExp(String.raw`^(${KIND}\s*)?(\d{1,3})(?:[.:)]\s*|\s*[-–—:]\s*|\s+)(\S.*)$`, "i");
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
  const entries = Array.from(doc.querySelectorAll("a[href]")).flatMap((a) => entryOf(a, base) ?? []);
  const here = pageKey(page.href);
  const folder = `${page.protocol}//${page.host.toLowerCase()}${page.pathname.replace(/\/index\.html?$/i, "/").replace(/[^/]*$/, "")}`;
  const run = runs(entries)
    .filter((r) => r.length <= MAX_CHAPTERS && (r.some((e) => e.key === here) || r.every((e) => `${e.key}/`.startsWith(folder))))
    .filter((r) => looksLikeContents(r, doc, base))
    .sort((a, b) => b.length - a.length)[0];
  if (!run) return null;
  // The same chapter is often linked twice, from a card and from the navigation: keep the plainest name.
  const names = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.written || !entry.title) continue;
    const known = names.get(entry.key);
    if (!known || entry.title.length < known.length) names.set(entry.key, entry.title);
  }
  const chapters = run.map((entry, i) => ({ url: entry.url, title: names.get(entry.key) || entry.title || `Chapter ${i + 1}` }));
  const at = run.findIndex((entry) => entry.key === here);
  const index = at < 0 ? null : at;
  return {
    id: `book:${hash(run[0].key)}`,
    title: bookTitle(doc, page, index === null ? null : chapters[index].title),
    chapters,
    index,
    ...(index === null ? { contents: page.href } : {}),
  };
}
