import { fencedCode, readingBlocks } from "./codeBlocks";
import { visualBlock, type ArticleVisual } from "./visuals";
import { articleVisual } from "./articleVisuals";

/** Fetch a web page and extract readable text. Direct fetch first, then the built-in /api/fetch route, then an optional readability proxy. */
export interface Fetched {
  title: string;
  text: string;
  domain: string;
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
  doc.querySelectorAll("script,noscript,nav,footer,header,aside,form,iframe,[aria-hidden='true']").forEach((n) => n.remove());
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
    const boundary = /^(?:H[1-6]|P|LI|BLOCKQUOTE|DIV|SECTION|BR|UL|OL|FIGURE|FIGCAPTION)$/.test(node.tagName);
    if (boundary) flush();
    node.childNodes.forEach(walk);
    if (boundary) flush();
  };
  walk(root);
  flush();
  const text = blocks.join("\n\n");
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || hostOf(url)).trim();
  return { title, text, domain: hostOf(url) };
}

export function markdownToText(md: string, base?: string): string {
  return readingBlocks(md, base).map((block) => block.kind === "visual" ? visualBlock(block.visual) : block.kind === "code" ? fencedCode(block.text, block.language) : block.text
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/^Markdown Content:\s*$/m, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
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
    return { title: domain, text: ct.includes("markdown") ? markdownToText(body, url) : body, domain };
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
  const text = markdownToText(md, url);
  if (text.length < 40) throw new Error("No readable text");
  return { title, text, domain };
}
