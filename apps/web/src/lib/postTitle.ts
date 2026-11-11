import type { DocMeta } from "./db";

/**
 * X names its pages `Name on X: "the post" / X`, and the share sheet hands that over as the
 * title. The name belongs in the author field and the site suffix says nothing the source icon
 * doesn't, so split them off and keep only the post's own headline.
 */
const X_DOMAIN = /^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/i;
const SUFFIX = String.raw`(?:\s+\/\s+(?:X|Twitter))`;
const WRAPPED = new RegExp(String.raw`^(.+?) on (?:X|Twitter): [“"](.*)[”"]${SUFFIX}?$`, "s");
const BARE = new RegExp(String.raw`^(.+?) on (?:X|Twitter)${SUFFIX}?$`, "s");

export const isXDomain = (domain?: string) => !!domain && X_DOMAIN.test(domain);

/** Only call for documents from X: "Thoughts on X" is a fine title anywhere else. */
export function splitPostTitle(title: string): { title: string; author?: string } {
  const t = title.trim();
  const wrapped = t.match(WRAPPED);
  if (wrapped) {
    const author = wrapped[1].trim(), headline = wrapped[2].trim();
    return { title: headline || `Post by ${author}`, author };
  }
  const bare = t.match(BARE);
  if (bare) return { title: `Post by ${bare[1].trim()}`, author: bare[1].trim() };
  return { title: t.replace(new RegExp(`${SUFFIX}$`), "") };
}

/** A document's title and author as shown, so posts saved with X's page title read cleanly too. */
export function catalogue(rec: { title: string; domain?: string; meta?: DocMeta }): { title: string; author?: string } {
  const split = isXDomain(rec.domain) ? splitPostTitle(rec.title) : { title: rec.title };
  const author = rec.meta?.author?.trim() || split.author;
  return author ? { title: split.title, author } : { title: split.title };
}
