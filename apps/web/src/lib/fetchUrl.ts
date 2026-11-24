import { request } from "@readaloud/practice/request";
import { fencedCode, readingBlocks } from "./codeBlocks";
import { visualBlock, type ArticleVisual } from "./visuals";
import { articleVisual } from "./articleVisuals";
import { PageStyles } from "./svgStyles";
import type { DocMeta } from "./db";

import { absoluteUrl, linksInMarkdown, linksInText, uniqueLinks, type DocLink } from "./links";
import { bookContents, breadcrumbParent, openedAt, pageKey, sectionsOf, withSections, type BookChapter, type BookContents } from "./book";
import { fetchArchiveBook } from "./archive";
import { epubBook } from "./bookFile";
import { isEpubFile } from "./epubType";
import { ReadError } from "./readError";

/** Fetch a web page and extract readable text. Direct fetch first, then the built-in /api/fetch route, then an optional readability proxy. */
export interface Fetched {
  title: string;
  text: string;
  domain: string;
  /** The link as fetched, plus whatever catalogue details the page declares */
  meta: DocMeta;
  /** Hyperlinks in the readable part of the page */
  links: DocLink[];
  /** The book this page is a chapter of, or the contents page for */
  book?: BookContents;
  /** The page the breadcrumbs put this one under, which may list it as a chapter when it lists nothing itself */
  partOf?: string;
}

// The server reads chapters with this module too, where there is no bundle environment.
const PROXY = import.meta.env?.VITE_FETCH_PROXY as string | undefined;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A single web address, with or without its scheme, as opposed to prose that happens to mention one. */
export function looksLikeUrl(input: string): boolean {
  const t = input.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  return /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]\S*)?$/i.test(t);
}

/** Nothing but a web address written out in full: a link wherever it was pasted, never prose to read aloud. */
export function isWebAddress(input: string): boolean {
  return /^(https?:\/\/|www\.)[^\s.]\S*$/i.test(input.trim());
}

export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!/^https?:\/\//i.test(t)) return `https://${t}`;
  return t;
}

/** "2026-10-01T09:00:00Z" → "2026-10-01"; anything unparseable is kept as written. */
export function publishedDate(value: string | null | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  // Date.parse guesses at anything with a year ("Spring 2025" → 1 January), so require a day too.
  const time = /\d{1,2}\D+\d{4}|\d{4}\D+\d{1,2}/.test(raw) ? Date.parse(raw) : NaN;
  return Number.isNaN(time) ? raw.slice(0, 100) : new Date(time).toISOString().slice(0, 10);
}

const clean = (value: string | null | undefined, max = 1000) => {
  const t = value?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/** Schema.org Article data, where most news sites and blogs name the author and date. */
function linkedData(doc: Document): { author?: string; published?: string } {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      const nodes: Record<string, unknown>[] = (Array.isArray(data) ? data : [data]).flatMap((node) => node?.["@graph"] ?? [node]);
      for (const node of nodes) {
        if (!node || typeof node !== "object" || !("datePublished" in node || "author" in node)) continue;
        const authors = ([] as unknown[]).concat(node.author ?? []);
        const names = authors.map((a) => (typeof a === "string" ? a : (a as { name?: unknown })?.name)).filter((n): n is string => typeof n === "string" && !!n.trim());
        return { author: names.join(", ") || undefined, published: typeof node.datePublished === "string" ? node.datePublished : undefined };
      }
    } catch { /* Malformed JSON-LD is common; fall back to meta tags. */ }
  }
  return {};
}

/** Catalogue details a page declares about itself, in the order sites most reliably fill them. */
export function pageMeta(doc: Document, url: string): DocMeta {
  const tag = (selector: string) => doc.querySelector(selector)?.getAttribute("content");
  const ld = linkedData(doc);
  const articleAuthor = tag('meta[property="article:author"]');
  const author = tag('meta[name="author"]') || ld.author || (articleAuthor && !/^https?:/i.test(articleAuthor) ? articleAuthor : null)
    || tag('meta[name="twitter:creator"]');
  const published = tag('meta[property="article:published_time"]') || ld.published || tag('meta[name="date"]')
    || tag('meta[itemprop="datePublished"]') || doc.querySelector("time[datetime]")?.getAttribute("datetime");
  const meta: DocMeta = {
    url,
    author: clean(author),
    published: publishedDate(published),
    site: clean(tag('meta[property="og:site_name"]')),
    description: clean(tag('meta[property="og:description"]') || tag('meta[name="description"]'), 2000),
  };
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value)) as DocMeta;
}

/** Notes set beside the text ("Tip", "Warning") are part of the article; sidebars are not. */
const NOTE = "note|notice|tip|hint|info|warning|caution|important|danger";
const CALLOUT = new RegExp(`callout|admonition|notecard|^(?:${NOTE})$|--(?:${NOTE})$`, "i");
function isCallout(aside: Element): boolean {
  if (aside.querySelector("nav,form")) return false;
  return aside.getAttribute("role") === "note" || (aside.getAttribute("class") ?? "").split(/\s+/).some((name) => CALLOUT.test(name));
}

const endsSentence = (text: string) => /[.!?…:;]["'”’)]?$/.test(text);
const cellText = (cell: Element) => (cell.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * A table as it would be read out: one paragraph per row, the row's first cell as its name and
 * the other cells under their column headings. Two-column tables read as "name: value".
 */
export function tableRows(table: Element): string[] {
  const rows = Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table)
    .map((row) => Array.from(row.children).filter((cell) => /^T[HD]$/.test(cell.tagName)));
  const first = rows[0];
  const headed = !!first?.length && rows.length > 1 && (first.every((cell) => cell.tagName === "TH") || !!first[0].closest("thead"));
  const headings = headed ? first.map(cellText) : [];
  const sentence = (text: string) => endsSentence(text) ? text : `${text}.`;
  return rows.slice(headed ? 1 : 0).flatMap((row) => {
    const cells = row.map(cellText);
    if (!cells.some(Boolean)) return [];
    if (!headed || cells.length !== headings.length) return [cells.filter(Boolean).map(sentence).join(" ")];
    const [name, ...rest] = cells;
    if (rest.length === 1) return [name && rest[0] ? sentence(`${name}: ${rest[0]}`) : sentence(name || rest[0])];
    const facts = rest.flatMap((cell, i) => cell ? [sentence(headings[i + 1] ? `${headings[i + 1]}: ${cell}` : cell)] : []);
    return [[...(name ? [sentence(name)] : []), ...facts].join(" ")];
  });
}

/** Linked stylesheets a page's pictures may be styled by, as absolute addresses. */
export function stylesheetLinks(doc: Document, url: string): string[] {
  if (!doc.querySelector("svg")) return [];
  return Array.from(doc.querySelectorAll('link[rel~="stylesheet" i][href]')).flatMap((link) => {
    const media = link.getAttribute("media");
    if (media && /\bprint\b|prefers-color-scheme\s*:\s*dark/i.test(media) && !/\bscreen\b|\ball\b/i.test(media)) return [];
    const href = absoluteUrl(link.getAttribute("href") ?? "", url);
    return href ? [href] : [];
  }).slice(0, MAX_STYLESHEETS);
}

/** The page's styles in document order: its own <style> blocks and whatever linked sheets were fetched. */
function pageCss(doc: Document, url: string, sheets: ReadonlyMap<string, string>): string[] {
  return Array.from(doc.querySelectorAll('style, link[rel~="stylesheet" i][href]')).flatMap((el) => {
    if (el.tagName === "STYLE") return el.closest("svg") ? [] : [el.textContent ?? ""];
    const css = sheets.get(absoluteUrl(el.getAttribute("href") ?? "", url) ?? "");
    return css ? [css] : [];
  });
}

/**
 * `sheets` holds the text of the page's linked stylesheets by address, so inline SVG pictures
 * that take their colours from the page keep them.
 */
export function htmlToText(html: string, url: string, sheets: ReadonlyMap<string, string> = new Map()): Fetched {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = pageMeta(doc, url);
  const styles = doc.querySelector("svg") ? new PageStyles(pageCss(doc, url, sheets)) : undefined;
  // The chapter list usually sits in the navigation, which is dropped next.
  const book = bookContents(doc, url);
  const partOf = book ? null : breadcrumbParent(doc, url);
  doc.querySelectorAll("script,noscript,nav,footer,header,aside,form,iframe,button,[aria-hidden='true']").forEach((n) => {
    if (n.tagName !== "ASIDE" || !isCallout(n)) n.remove();
  });
  doc.querySelectorAll("style").forEach((style) => { if (!style.closest("svg")) style.remove(); });
  const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.querySelector('[role="main"]') ?? doc.body;
  root.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const language = (code?.className || pre.className).match(/(?:language|lang)-([\w#+.-]+)/)?.[1] ?? "";
    // Replace with a single leaf so nested syntax-highlighter nodes cannot duplicate code.
    pre.textContent = fencedCode(pre.textContent ?? "", language);
  });
  let base = url;
  try { base = new URL(doc.querySelector("base[href]")?.getAttribute("href") || url, url).href; } catch { /* Use the article URL. */ }
  const captions = new Set<Element>();
  const visuals = new Map<Element, ArticleVisual>();
  let embeddedBytes = 0;
  for (const el of root.querySelectorAll("img,svg")) {
    const captionEl = el.closest("figure")?.querySelector("figcaption");
    const caption = captionEl?.textContent?.replace(/\s+/g, " ").trim() || "";
    const visual = articleVisual(el, base, caption, styles);
    if (!visual) continue;
    if (visual.src.startsWith("data:")) {
      embeddedBytes += visual.src.length;
      if (embeddedBytes > 1_000_000) visual.src = "";
    }
    visuals.set(el, visual);
    if (captionEl) captions.add(captionEl);
  }
  const blocks: string[] = [];
  let inline = "";
  const flush = () => {
    const text = inline.replace(/\s+/g, " ").trim();
    if (text) blocks.push(text);
    inline = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { inline += node.textContent ?? ""; return; }
    if (!(node instanceof Element)) return;
    if (captions.has(node)) return;
    if (node.tagName === "IMG" || node.tagName.toLowerCase() === "svg") {
      const visual = visuals.get(node);
      if (visual) { flush(); blocks.push(visualBlock(visual)); }
      return;
    }
    if (node.tagName === "PRE") { flush(); blocks.push(node.textContent ?? ""); return; }
    if (node.tagName === "TABLE") { flush(); blocks.push(...tableRows(node)); return; }
    const heading = node.tagName.match(/^H([1-6])$/);
    if (heading) {
      flush();
      node.childNodes.forEach(walk);
      const title = inline.replace(/\s+/g, " ").trim();
      inline = "";
      // Marked the way Markdown marks them, so the reading keeps its outline.
      if (title) blocks.push(`${"#".repeat(Number(heading[1]))} ${title}`);
      return;
    }
    const boundary = /^(?:P|LI|BLOCKQUOTE|DIV|SECTION|ASIDE|BR|UL|OL|DL|DT|DD|FIGURE|FIGCAPTION)$/.test(node.tagName);
    if (boundary) flush();
    // A row of labels with no text between them ("Part 7", "13 chapters", "106 figures") is spaced
    // out by the page's styles, not its text: keep them apart as words.
    const row = node.children.length > 1 && Array.from(node.childNodes).every((child) => child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim());
    node.childNodes.forEach((child) => { walk(child); if (row) inline += " "; });
    if (boundary) flush();
  };
  walk(root);
  flush();
  const text = blocks.join("\n\n");
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || hostOf(url)).trim();
  // Links drawn inside a diagram are labels in a picture, not places the reading points to.
  const links = Array.from(root.querySelectorAll("a[href]")).filter((a) => !a.closest("svg")).flatMap((a) => {
    const href = absoluteUrl(a.getAttribute("href") ?? "", base);
    return href ? [{ url: href, text: a.textContent ?? "" }] : [];
  });
  return { title, text, domain: hostOf(url), meta, links: uniqueLinks(links), ...(book ? { book } : partOf ? { partOf } : {}) };
}

export function markdownToText(md: string, base?: string): string {
  return readingBlocks(md, base).map((block) => block.kind === "visual" ? visualBlock(block.visual) : block.kind === "code" ? fencedCode(block.text, block.language) : block.text
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/^Published Time:.*$/m, "")
    .replace(/^Markdown Content:\s*$/m, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]+/g, "")
    .trim()).filter(Boolean).join("\n\n");
}

const MAX_STYLESHEETS = 8;
const MAX_STYLESHEET_CHARS = 1_000_000;
const STYLESHEET_TIMEOUT_MS = 6000;

async function fetchStylesheet(href: string, signal?: AbortSignal): Promise<string> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), STYLESHEET_TIMEOUT_MS);
  const abort = () => stop.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) stop.abort();
  try {
    return await fetchStylesheetWith(href, stop.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function fetchStylesheetWith(href: string, either: AbortSignal): Promise<string> {
  const read = async (r: Response) => {
    if (!r.ok || /html|json/i.test(r.headers.get("content-type") ?? "")) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_STYLESHEET_CHARS) throw new Error("too large");
    return text;
  };
  try {
    return await read(await request(href, { signal: either, timeoutMs: STYLESHEET_TIMEOUT_MS, mode: "cors", credentials: "omit" }));
  } catch {
    if (either.aborted) return "";
  }
  try {
    return await read(await request(`/api/fetch?url=${encodeURIComponent(href)}`, { signal: either, timeoutMs: STYLESHEET_TIMEOUT_MS }));
  } catch {
    return "";
  }
}

/** The linked stylesheets a page's inline pictures need, fetched side by side. A sheet that can't be read is left out. */
async function pageStylesheets(html: string, url: string, signal?: AbortSignal): Promise<Map<string, string>> {
  if (!url || !/<svg[\s>]/i.test(html)) return new Map();
  const links = stylesheetLinks(new DOMParser().parseFromString(html, "text/html"), url);
  const texts = await Promise.all(links.map((href) => fetchStylesheet(href, signal)));
  return new Map(links.map((href, i) => [href, texts[i]] as const).filter(([, css]) => css));
}

/** The name a file was sent under, or the one at the end of its address. */
function fileName(r: Response, url: string): string {
  const sent = r.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
  let last = "";
  try { last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? ""; } catch { /* No address to name it by. */ }
  for (const name of [sent, last]) {
    if (!name) continue;
    try { return decodeURIComponent(name); } catch { return name; }
  }
  return "";
}

/**
 * A book file behind a link, shelved like any book fetched from a site: its chapters carry the
 * link, and the first opens with an offer to add the rest.
 */
function linkedBook(page: Fetched, url: string, domain: string): Fetched {
  const meta = { ...page.meta, url };
  if (!page.book) return { ...page, domain, meta };
  const { file: _, ...book } = page.book;
  return { ...page, domain, meta, book: { ...book, meta, chapters: book.chapters.map((chapter) => ({ ...chapter, url })) } };
}

async function readResponse(r: Response, url: string, domain: string, signal?: AbortSignal): Promise<Fetched> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  // A PDF is not text: only the server can read one, and it answers with a page of HTML.
  if (/application\/(?:x-)?pdf/i.test(ct)) {
    void r.body?.cancel().catch(() => {});
    throw new Error("PDF");
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const name = fileName(r, url);
  // A link to an EPUB is a link to a whole book. One that can't be opened says why.
  if (isEpubFile(bytes, ct, name)) return linkedBook(epubBook(name, bytes), url, domain);
  const body = new TextDecoder().decode(bytes);
  if (body.startsWith("%PDF-")) throw new Error("PDF");
  if (ct.includes("html")) {
    const f = htmlToText(body, url, await pageStylesheets(body, url, signal));
    if (f.text.length > 40) return f;
  } else if (body.trim().length > 40) {
    const text = ct.includes("markdown") ? markdownToText(body, url) : body;
    return { title: domain, text, domain, meta: { url }, links: ct.includes("markdown") ? linksInMarkdown(body, url) : linksInText(body) };
  }
  throw new Error("No readable text");
}

/**
 * One chapter of a book already known, read off its own page alone. Unlike fetchReadable it asks
 * no other page which book this is (the parts of a book in parts, the page above): a book of 25
 * parts would otherwise cost every chapter 25 more pages.
 */
export async function readChapterPage(r: Response, url: string, signal?: AbortSignal): Promise<Fetched> {
  const { partOf: _, ...page } = await readResponse(r, url, hostOf(url), signal);
  return page;
}

/** A page straight from its site; the server gives a site as long (vite.fetch.ts). */
const DIRECT_TIMEOUT_MS = 20_000;
/** A page through a proxy, which waits 20 s for the site, or 2 minutes for a PDF (vite.fetch.ts). */
const PROXIED_TIMEOUT_MS = 150_000;
/** A PDF of tens of megabytes sent over a phone's uplink, then read on the server. */
const PDF_UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** A PDF chosen from the device, read by the server into the same shape as a fetched page. */
export async function readPdfFile(file: File, signal?: AbortSignal): Promise<Fetched> {
  const r = await request(`/api/fetch/pdf?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "content-type": "application/pdf" }, signal, timeoutMs: PDF_UPLOAD_TIMEOUT_MS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { ...htmlToText(await r.text(), ""), domain: file.name };
}

const PARENT_TIMEOUT_MS = 8000;

async function pageHtml(url: string, signal: AbortSignal): Promise<string> {
  const read = async (r: Response) => {
    if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };
  try {
    return await read(await request(url, { signal, timeoutMs: DIRECT_TIMEOUT_MS, mode: "cors" }));
  } catch (e) {
    if (signal.aborted) throw e;
  }
  return read(await request(`/api/fetch?url=${encodeURIComponent(url)}`, { signal, timeoutMs: PROXIED_TIMEOUT_MS }));
}

/**
 * A page that names the page above it but lists no chapters of its own is looked up on that
 * page: a track's notes link only back to the track, which lists them all in order.
 */
async function withParentBook(page: Fetched, signal?: AbortSignal): Promise<Fetched> {
  const { partOf, ...rest } = page;
  if (!partOf || page.book) return rest;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), PARENT_TIMEOUT_MS);
  const abort = () => stop.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const doc = new DOMParser().parseFromString(await pageHtml(partOf, stop.signal), "text/html");
    const contents = bookContents(doc, partOf);
    const book = contents && contents.index === null ? openedAt(contents, page.meta.url ?? "") : null;
    return book ? { ...rest, book } : rest;
  } catch (e) {
    if (signal?.aborted) throw e;
    return rest;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const PARTS_TIMEOUT_MS = 30000;
const PARTS_AT_ONCE = 4;

/**
 * A book in parts keeps each part's sections on the part's own page, and they are what there is
 * to read: every part not yet seen open is asked for its sections. A contents page that shows no
 * sections is settled by its first chapter, so an ordinary book costs one page.
 */
async function withPartSections(page: Fetched, signal?: AbortSignal): Promise<Fetched> {
  const { book } = page;
  if (!book?.unread && !book?.tail) return page;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), PARTS_TIMEOUT_MS);
  const abort = () => stop.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const found = new Map<string, BookChapter[]>();
  const read = async ({ url, n }: { url: string; n?: number }) => {
    try {
      const sections = sectionsOf(new DOMParser().parseFromString(await pageHtml(url, stop.signal), "text/html"), url, n);
      if (sections.length) found.set(pageKey(url), sections);
    } catch { /* A part that can't be read stays one chapter. */ }
  };
  try {
    const queue: { url: string; n?: number }[] = (book.unread ?? []).map((url) => ({ url }));
    let parted = true;
    if (queue.length === book.chapters.length) {
      await read(queue.shift()!);
      parted = found.size > 0;
      if (!parted) queue.length = 0;
    }
    if (parted && book.tail) queue.push(book.tail);
    const worker = async () => { for (let part = queue.shift(); part; part = queue.shift()) await read(part); };
    await Promise.all(Array.from({ length: PARTS_AT_ONCE }, worker));
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return { ...page, book: withSections(book, found) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Direct fetch (works for CORS-enabled pages), then the dev/preview server's /api/fetch, then VITE_FETCH_PROXY.
 * A book on the Internet Archive is read from its files instead of its page. Throws a ReadError
 * when the reason the link can't be read is worth passing on.
 */
export async function fetchReadable(input: string, signal?: AbortSignal): Promise<Fetched> {
  const url = normalizeUrl(input);
  const domain = hostOf(url);
  try {
    const book = await fetchArchiveBook(url, signal);
    if (book) return book;
  } catch (e) {
    // Anything else and the page itself is still worth a try.
    if (e instanceof ReadError || signal?.aborted) throw e;
  }
  try {
    return await withPartSections(await withParentBook(await readResponse(await request(url, { signal, timeoutMs: DIRECT_TIMEOUT_MS, mode: "cors" }), url, domain, signal), signal), signal);
  } catch (e) {
    if (e instanceof ReadError || signal?.aborted) throw e;
  }
  try {
    return await withPartSections(await withParentBook(await readResponse(await request(`/api/fetch?url=${encodeURIComponent(url)}`, { signal, timeoutMs: PROXIED_TIMEOUT_MS }), url, domain, signal), signal), signal);
  } catch (e) {
    if (!PROXY || e instanceof ReadError || signal?.aborted) throw e;
  }
  const r = await request(PROXY.replace("{url}", url), { signal, timeoutMs: PROXIED_TIMEOUT_MS, headers: { Accept: "text/plain" } });
  if (!r.ok) throw new Error(`Proxy HTTP ${r.status}`);
  const md = await r.text();
  const title = md.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || domain;
  const text = markdownToText(md, url);
  if (text.length < 40) throw new Error("No readable text");
  const published = publishedDate(md.match(/^Published Time:\s*(.+)$/m)?.[1]);
  const content = md.replace(/^(Title|URL Source|Published Time):.*$/gm, "");
  return { title, text, domain, meta: published ? { url, published } : { url }, links: linksInMarkdown(content, url) };
}
