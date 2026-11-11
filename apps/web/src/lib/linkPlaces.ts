import { linksInText, type DocLink } from "./links";

/** A word in the reading: sentence index and word index within it. */
export interface Place {
  sentence: number;
  word: number;
}

export interface PlacedLink extends DocLink {
  /** The last word of the link as it is read; null when its words are not in the reading. */
  at: Place | null;
}

/** Lower-case, without the punctuation around a word, so "docs," matches "Docs". */
const bare = (word: string) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * Find where each link is read. Stored links carry their text but not a position, so a link
 * is matched to the first unclaimed run of its words at or after the link before it, then
 * anywhere; a link written out as a URL is matched to the word holding that URL. The result
 * is in reading order, with links that could not be found at the end.
 */
export function placeLinks(links: readonly DocLink[], sentences: readonly { words: readonly string[] }[]): PlacedLink[] {
  const words: { place: Place; text: string }[] = [];
  const byWord = new Map<string, number[]>();
  const byUrl = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, i: number) => {
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  };
  sentences.forEach((s, sentence) => s.words.forEach((raw, word) => {
    const text = bare(raw);
    if (!text) return;
    const i = words.length;
    words.push({ place: { sentence, word }, text });
    add(byWord, text, i);
    if (raw.includes("://")) for (const { url } of linksInText(raw)) add(byUrl, url, i);
  }));

  const claimed = new Set<number>();
  let cursor = 0;
  const pick = (starts: number[]) => starts.find((i) => i >= cursor && !claimed.has(i)) ?? starts.find((i) => !claimed.has(i));
  const placed = links.map((link, order) => {
    const tokens = link.text === link.url ? [] : link.text.split(/\s+/).map(bare).filter(Boolean);
    let start = tokens.length
      ? pick((byWord.get(tokens[0]) ?? []).filter((i) => tokens.every((t, k) => words[i + k]?.text === t)))
      : undefined;
    let length = tokens.length;
    if (start === undefined) {
      start = pick(byUrl.get(link.url) ?? []);
      length = 1;
    }
    if (start === undefined) return { link: { ...link, at: null }, order, end: Infinity };
    claimed.add(start);
    cursor = start + length;
    return { link: { ...link, at: words[start + length - 1].place }, order, end: start + length - 1 };
  });
  return placed.sort((a, b) => a.end - b.end || a.order - b.order).map((p) => p.link);
}

/** How many of the placed links (in reading order) are behind the listener. A finished reading has passed them all. */
export function linksPassed(links: readonly PlacedLink[], at: { index: number; wordIndex: number; ended: boolean }): number {
  if (at.ended) return links.length;
  let low = 0, high = links.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const place = links[mid].at;
    if (place && (at.index > place.sentence || (at.index === place.sentence && at.wordIndex > place.word))) low = mid + 1;
    else high = mid;
  }
  return low;
}

export interface LinkFollower {
  links: readonly PlacedLink[];
  docId: string | null;
  seeks: number;
  /** Links already behind the listener; null after a jump into a sentence, until the clock names a word. */
  mark: number | null;
}

/**
 * Follow playback and report the links that have just been read aloud. Jumping (opening,
 * seeking, restarting) moves the mark without reporting, and slipping back a word on
 * resume never reports a link twice.
 */
export function followLinks(
  prev: LinkFollower | null,
  links: readonly PlacedLink[],
  snap: { docId: string | null; seeks: number; index: number; wordIndex: number; offset: number; ended: boolean },
): { follower: LinkFollower; heard: PlacedLink[] } {
  const count = linksPassed(links, snap);
  const same = !!prev && prev.links === links && prev.docId === snap.docId && prev.seeks === snap.seeks;
  if (!prev || !same || prev.mark === null) {
    // Mid-sentence with no word yet: the place is only known once the clock reports one.
    const mark = snap.wordIndex >= 0 || snap.offset === 0 || snap.ended ? count : null;
    return { follower: prev && same && prev.mark === mark ? prev : { links, docId: snap.docId, seeks: snap.seeks, mark }, heard: [] };
  }
  if (count <= prev.mark) return { follower: prev, heard: [] };
  return { follower: { ...prev, mark: count }, heard: links.slice(prev.mark, count).filter((link) => link.at) };
}
