import { fencedCode, readingBlocks } from "./codeBlocks";
import { visualBlock, type ArticleVisual } from "./visuals";
import { articleVisual } from "./articleVisuals";
import type { DocMeta } from "./db";

import { absoluteUrl, linksInMarkdown, linksInText, uniqueLinks, type DocLink } from "./links";
import { bookContents, type BookContents } from "./book";
import { fetchArchiveBook } from "./archive";
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
}

const PROXY = import.meta.env.VITE_FETCH_PROXY as string | undefined;

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

export function htmlToText(html: string, url: string): Fetched {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = pageMeta(doc, url);
  // The chapter list usually sits in the navigation, which is dropped next.
  const book = bookContents(doc, url);
  doc.querySelectorAll("script,noscript,nav,footer,header,aside,form,iframe,[aria-hidden='true']").forEach((n) => {
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
    const visual = articleVisual(el, base, caption);
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
    node.childNodes.forEach(walk);
    if (boundary) flush();
  };
  walk(root);
  flush();
  const text = blocks.join("\n\n");
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || hostOf(url)).trim();
  const links = Array.from(root.querySelectorAll("a[href]")).flatMap((a) => {
    const href = absoluteUrl(a.getAttribute("href") ?? "", base);
    return href ? [{ url: href, text: a.textContent ?? "" }] : [];
  });
  return { title, text, domain: hostOf(url), meta, links: uniqueLinks(links), ...(book ? { book } : {}) };
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

async function readResponse(r: Response, url: string, domain: string): Promise<Fetched> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  const body = await r.text();
  if (ct.includes("html")) {
    const f = htmlToText(body, url);
    if (f.text.length > 40) return f;
  } else if (body.trim().length > 40) {
    const text = ct.includes("markdown") ? markdownToText(body, url) : body;
    return { title: domain, text, domain, meta: { url }, links: ct.includes("markdown") ? linksInMarkdown(body, url) : linksInText(body) };
  }
  throw new Error("No readable text");
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
    return await readResponse(await fetch(url, { signal, mode: "cors" }), url, domain);
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  try {
    return await readResponse(await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { signal }), url, domain);
  } catch (e) {
    if (!PROXY || signal?.aborted) throw e;
  }
  const r = await fetch(PROXY.replace("{url}", url), { signal, headers: { Accept: "text/plain" } });
  if (!r.ok) throw new Error(`Proxy HTTP ${r.status}`);
  const md = await r.text();
  const title = md.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || domain;
  const text = markdownToText(md, url);
  if (text.length < 40) throw new Error("No readable text");
  const published = publishedDate(md.match(/^Published Time:\s*(.+)$/m)?.[1]);
  const content = md.replace(/^(Title|URL Source|Published Time):.*$/gm, "");
  return { title, text, domain, meta: published ? { url, published } : { url }, links: linksInMarkdown(content, url) };
}
