/** Fetch a web page and extract readable text. Direct fetch first, then the built-in /api/fetch route, then an optional readability proxy. */
import { absoluteUrl, linksInMarkdown, linksInText, uniqueLinks, type DocLink } from "./links";

export interface Fetched {
  title: string;
  text: string;
  domain: string;
  /** Hyperlinks in the readable part of the page */
  links: DocLink[];
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

export function htmlToText(html: string, url: string): Fetched {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,aside,form,iframe,[aria-hidden='true']").forEach((n) => n.remove());
  const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.querySelector('[role="main"]') ?? doc.body;
  const blocks = Array.from(root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1);
  const text = (blocks.length ? blocks : [(root.textContent ?? "").replace(/\s+/g, " ").trim()]).join("\n\n");
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || hostOf(url)).trim();
  const base = doc.querySelector("base[href]")?.getAttribute("href") ?? "";
  const links = Array.from(root.querySelectorAll("a[href]")).flatMap((a) => {
    const href = absoluteUrl(a.getAttribute("href") ?? "", absoluteUrl(base, url) ?? url);
    return href ? [{ url: href, text: a.textContent ?? "" }] : [];
  });
  return { title, text, domain: hostOf(url), links: uniqueLinks(links) };
}

function markdownToText(md: string): string {
  return md
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
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
    return { title: domain, text: body, domain, links: linksInText(body) };
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
  const content = md.replace(/^(Title|URL Source):.*$/gm, "");
  return { title, text, domain, links: linksInMarkdown(content, url) };
}
