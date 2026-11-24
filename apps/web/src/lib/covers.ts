import { readingBlocks } from "./codeBlocks";
import type { DocMeta } from "./db";
import { hash } from "./hash";
import { catalogue } from "./postTitle";
import { proseParts } from "./segment";

/**
 * What a document's covers are of: the article, and every section under a heading. The server
 * draws from this and the Reader places by it, so both read the text the same way.
 */

/** The look every cover shares. Changing it makes new art instead of reusing the old. */
export const COVER_STYLE = "field-notes-1";
export const ARTICLE_COVER = "article";

export interface CoverSection {
  /** Stays the same while the headings above it and its place among same-named ones do */
  key: string;
  kind: "article" | "section";
  /** The article's title, or the heading as written */
  heading: string;
  /** 0 for the article, else the heading's level, 1 the largest */
  level: number;
  /** Headings from the outermost section down to this one; empty for the article */
  path: string[];
  /** Which of the document's headings this is, counted from 0 as the Reader lists them; -1 for the article */
  ordinal: number;
  /** The key of the section this one is inside; empty for the article */
  parent: string;
  /** The prose under it, with the sections inside it. Code and pictures are left out. */
  body: string;
}

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The article first, then its sections in reading order. A heading that repeats the title is the
 * article itself, not a section of it. Two headings with the same words stay two sections.
 */
export function coverPlan(rec: { title: string; text: string; domain?: string; meta?: DocMeta }): { sections: CoverSection[]; /** Headings in the text, the title's own among them */ headings: number } {
  const title = catalogue(rec).title.trim();
  const article: CoverSection = { key: ARTICLE_COVER, kind: "article", heading: title, level: 0, path: [], ordinal: -1, parent: "", body: "" };
  const sections: CoverSection[] = [];
  /** The sections the text now being read is inside, outermost first. */
  const open: CoverSection[] = [];
  const seen = new Map<string, number>();
  const add = (text: string) => { for (const section of [article, ...open]) section.body += `${section.body ? "\n\n" : ""}${text}`; };
  let ordinal = 0;
  for (const block of readingBlocks(rec.text)) {
    if (block.kind !== "prose") continue;
    for (const part of proseParts(block.text)) {
      if (!part.heading) { add(part.text); continue; }
      const at = ordinal++;
      if (plain(part.text) === plain(title) && (at === 0 || part.heading === 1)) { open.length = 0; continue; }
      while (open.length && open[open.length - 1].level >= part.heading) open.pop();
      // A heading inside a section is part of what that section covers.
      add(part.text);
      const path = [...open.map((section) => section.heading), part.text];
      const base = hash(path.join("\u0000"));
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      const section: CoverSection = {
        key: `${base}-${occurrence}`, kind: "section", heading: part.text, level: part.heading, path, ordinal: at,
        parent: open.length ? open[open.length - 1].key : ARTICLE_COVER, body: "",
      };
      sections.push(section);
      open.push(section);
    }
  }
  return { sections: [article, ...sections], headings: ordinal };
}

/** Which paragraph each section's cover goes before, when the text shown has the headings the covers were made from. */
export function coverPlaces(paragraphs: readonly { heading?: number }[], covers: readonly { key: string; ordinal: number }[], headings: number): Map<number, string> {
  const places = new Map<number, string>();
  const shown = paragraphs.flatMap((paragraph, index) => paragraph.heading ? [index] : []);
  // A rewrite (Patois, a summary) may not keep the headings; then nothing is placed.
  if (shown.length !== headings) return places;
  for (const cover of covers) if (cover.ordinal >= 0 && cover.ordinal < shown.length) places.set(shown[cover.ordinal], cover.key);
  return places;
}
