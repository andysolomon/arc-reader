import type { DocMeta } from "./db";

/** Fetch a web page and extract readable text. Direct fetch first, then the built-in /api/fetch route, then an optional readability proxy. */
export interface Fetched {
  title: string;
  text: string;
  domain: string;
  /** The link as fetched, plus whatever catalogue details the page declares */
  meta: DocMeta;
}

const PROXY = import.meta.env.VITE_FETCH_PROXY as string | undefined;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

export function htmlToText(html: string, url: string): Fetched {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = pageMeta(doc, url);
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,aside,form,iframe,[aria-hidden='true']").forEach((n) => n.remove());
  const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.querySelector('[role="main"]') ?? doc.body;
  const blocks = Array.from(root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1);
  const text = (blocks.length ? blocks : [(root.textContent ?? "").replace(/\s+/g, " ").trim()]).join("\n\n");
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || hostOf(url)).trim();
  return { title, text, domain: hostOf(url), meta };
}

function markdownToText(md: string): string {
  return md
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/^Published Time:.*$/m, "")
    .replace(/^Markdown Content:\s*$/m, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]+/g, "")
    .trim();
}

async function readResponse(r: Response, url: string, domain: string): Promise<Fetched> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  const body = await r.text();
  if (ct.includes("html")) {
    const f = htmlToText(body, url);
    if (f.text.length > 40) return f;
  } else if (body.trim().length > 40) {
    return { title: domain, text: body, domain, meta: { url } };
  }
  throw new Error("No readable text");
}

/** Direct fetch (works for CORS-enabled pages), then the dev/preview server's /api/fetch, then VITE_FETCH_PROXY. */
export async function fetchReadable(input: string, signal?: AbortSignal): Promise<Fetched> {
  const url = normalizeUrl(input);
  const domain = hostOf(url);
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
  const text = markdownToText(md);
  if (text.length < 40) throw new Error("No readable text");
  const published = publishedDate(md.match(/^Published Time:\s*(.+)$/m)?.[1]);
  return { title, text, domain, meta: published ? { url, published } : { url } };
}
