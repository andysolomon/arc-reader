/** A hyperlink found in a document: where it points and the words it was attached to. */
export interface DocLink {
  url: string;
  /** Anchor or Markdown link text; the URL itself for bare links. */
  text: string;
}

export const MAX_LINKS = 2000;
export const MAX_LINK_URL = 4000;
export const MAX_LINK_TEXT = 1000;

/** An absolute http(s) URL, resolved against `base` when relative; null for mailto:, javascript:, in-page anchors and junk. */
export function absoluteUrl(href: string, base?: string): string | null {
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (base && url.hash && url.href.split("#")[0] === new URL(base).href.split("#")[0]) return null;
    return url.href.length <= MAX_LINK_URL ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * True for an address that names no real place: the domains set aside for examples
 * (example.com, *.test, *.invalid, localhost…) and host names with no dot, such as the
 * "http://”" a page writes when it means the scheme and a parser reads as a host.
 */
export function placeholderUrl(href: string): boolean {
  let host: string;
  try { host = new URL(href).hostname.toLowerCase().replace(/\.$/, ""); } catch { return true; }
  if (host.startsWith("[")) return host === "[::1]" || host === "[::]";
  if (!host.includes(".")) return true;
  return /(?:^|\.)example\.(?:com|net|org)$|\.(?:example|test|invalid|localhost|local)$|^(?:127\.|0\.0\.0\.0$)/.test(host);
}

/** Keep the first occurrence of each URL, in document order, with tidy text. Placeholder addresses are left out. */
export function uniqueLinks(links: Iterable<DocLink>): DocLink[] {
  const seen = new Map<string, DocLink>();
  for (const { url, text } of links) {
    if (seen.size >= MAX_LINKS) break;
    if (placeholderUrl(url)) continue;
    const tidy = text.replace(/\s+/g, " ").trim().slice(0, MAX_LINK_TEXT);
    const known = seen.get(url);
    if (!known) seen.set(url, { url, text: tidy || url });
    else if (known.text === url && tidy) known.text = tidy;
  }
  return [...seen.values()];
}

const BARE = /\bhttps?:\/\/[^\s<>"'`“”‘’«»…]+/gi;
const MARKDOWN = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Bare URLs in plain text, minus trailing sentence punctuation and unbalanced closing brackets. */
export function linksInText(text: string): DocLink[] {
  const found: DocLink[] = [];
  for (const [match] of text.matchAll(BARE)) {
    let raw = match.replace(/[.,;:!?]+$/, "");
    while (/[)\]]$/.test(raw) && count(raw, raw.endsWith(")") ? "(" : "[") < count(raw, raw.slice(-1))) raw = raw.slice(0, -1).replace(/[.,;:!?]+$/, "");
    const url = absoluteUrl(raw);
    // "http://" on its own, or followed by punctuation, names the scheme, not a place.
    if (url && /[a-z0-9]/i.test(new URL(url).hostname)) found.push({ url, text: url });
  }
  return uniqueLinks(found);
}

/** `[text](url)` links in Markdown, skipping images; bare URLs elsewhere in the text are included too. */
export function linksInMarkdown(md: string, base?: string): DocLink[] {
  const found: DocLink[] = [];
  for (const [, image, text, href] of md.matchAll(MARKDOWN)) {
    const url = !image && absoluteUrl(href, base);
    if (url) found.push({ url, text });
  }
  return uniqueLinks([...found, ...linksInText(md.replace(MARKDOWN, " "))]);
}

const count = (s: string, ch: string) => s.split(ch).length - 1;
