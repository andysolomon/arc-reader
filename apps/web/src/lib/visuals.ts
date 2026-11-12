import { hash } from "./hash";

export interface ArticleVisual {
  /** A slide is a picture of a whole page of a deck, kept by this server */
  kind: "image" | "diagram" | "slide";
  src: string;
  alt: string;
  caption: string;
}
export type VisualDescriptions = Record<string, string>;
export const VISUAL_FENCE = "readaloud-visual";

/** Where this server keeps the picture of a slide: the deck's fingerprint and the page. */
export const SLIDE_SOURCE = /^\/api\/slides\/[a-f0-9]{32}\/\d{1,4}\.jpg$/;

/** Only inert image sources. Never make local paths, credentials, or script URLs into images. */
export function imageSource(input: string, base?: string): string {
  if (SLIDE_SOURCE.test(input)) return input;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(input)) return input.length <= 350_000 ? input : "";
  if (/^data:image\/svg\+xml;charset=utf-8,/i.test(input)) return input.length <= 150_000 ? input : "";
  if (input.length > 8192) return "";
  try {
    const url = new URL(input, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}

export function visualFrom(value: unknown): ArticleVisual | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ArticleVisual>;
  if (v.kind !== "image" && v.kind !== "diagram" && v.kind !== "slide") return null;
  if (typeof v.src !== "string" || typeof v.alt !== "string" || typeof v.caption !== "string") return null;
  const src = imageSource(v.src);
  return { kind: v.kind === "slide" && !SLIDE_SOURCE.test(src) ? "image" : v.kind, src, alt: v.alt.slice(0, 1200), caption: v.caption.slice(0, 1600) };
}

export function visualBlock(visual: ArticleVisual): string {
  // Escape backticks so source captions cannot close the metadata fence.
  return `\`\`\`${VISUAL_FENCE}\n${JSON.stringify(visual).replace(/`/g, "\\u0060")}\n\`\`\``;
}
export const visualKey = (visual: ArticleVisual) => `visual-v1:${hash(JSON.stringify(visual))}:${visual.src.length}`;

export function safeVisualDescription(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= 1000 && value.split(/\s+/).length <= 150
    && !/https?:|data:|```|[{}]|<\/?[a-z]|\n/i.test(value);
}

/** Only speak meaningful article-provided descriptions, never URLs or filenames. */
function captionText(text: string): string {
  const clean = text.replace(/https?:\/\/\S+|data:\S+/gi, "").replace(/<[^>]*>/g, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || /^(?:image|photo|picture|diagram|figure|untitled)(?:\s*\d+)?[.!:]?$/i.test(clean)
    || /^\S+\.(?:png|jpe?g|webp|gif|svg)$/i.test(clean)) return "";
  return clean.length > 600 ? clean.slice(0, 600).replace(/\s+\S*$/, "") + "…" : clean;
}
/** Read in place of a slide's picture until it has a description. */
export const SLIDE_STAND_IN = "This slide has a picture.";

export function visualNarration(visual: ArticleVisual, descriptions: VisualDescriptions = {}): { text: string; source: "description" | "caption" | "unavailable" } {
  const description = descriptions[visualKey(visual)];
  if (safeVisualDescription(description)) return { text: description.trim(), source: "description" };
  // A deck has a picture on most slides, and the slide's own words are read next: keep the stand-in short.
  if (visual.kind === "slide") return { text: SLIDE_STAND_IN, source: "unavailable" };
  const caption = captionText(visual.caption) || captionText(visual.alt);
  const label = visual.kind === "diagram" ? "Diagram" : "Image";
  return caption ? { text: `${label} description from the article: ${caption}`, source: "caption" }
    : { text: `An ${visual.kind === "diagram" ? "illustrated diagram" : "image"} appears here. A description is unavailable, so we’ll continue.`, source: "unavailable" };
}

/** What a visual adds to the document's text for a model reading it: nothing, for a slide not yet described. */
export function visualText(visual: ArticleVisual, descriptions: VisualDescriptions = {}): string {
  const narration = visualNarration(visual, descriptions);
  return visual.kind === "slide" && narration.source === "unavailable" ? "" : narration.text;
}

/** Inline Markdown pictures become their own listening targets, keeping surrounding prose. */
export function markdownVisuals(text: string, base?: string): ({ kind: "prose"; text: string } | { kind: "visual"; text: string; visual: ArticleVisual })[] {
  const out: ReturnType<typeof markdownVisuals> = [];
  const pattern = /!\[([^\]\n]*)\]\(\s*(?:<([^>]+)>|((?:[^()\s]|\([^()\n]*\))+))(?:\s+["']([^"'\n]*)["'])?\s*\)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(offset, match.index).trim();
    if (before) out.push({ kind: "prose", text: before });
    const visual: ArticleVisual = { kind: "image", src: imageSource(match[2] || match[3], base), alt: match[1], caption: match[4] || "" };
    out.push({ kind: "visual", text: visualBlock(visual), visual });
    offset = match.index! + match[0].length;
  }
  const after = text.slice(offset).trim();
  if (after) out.push({ kind: "prose", text: after });
  return out;
}
