import { useEffect } from "react";
import { hostOf } from "../lib/fetchUrl";
import { followLinks, linksPassed, placeLinks, type LinkFollower, type PlacedLink } from "../lib/linkPlaces";
import { linksInMarkdown, type DocLink } from "../lib/links";
import { usePlayer, type PlayerState } from "./player";
import { useSettings } from "./settings";
import { toast } from "./toast";

export const LINK_TOAST_MS = 5000;
const NONE: PlacedLink[] = [];
type Reading = Pick<PlayerState, "doc" | "record" | "summary">;
let cache: { sentences: unknown; links: DocLink[] | undefined; text: string; placed: PlacedLink[] } | null = null;

/**
 * The open reading's links in the order they are read. Empty while its summary is read.
 * Documents saved before links were kept still get the addresses written into their text.
 */
export function docLinks({ doc, record, summary }: Reading): PlacedLink[] {
  if (!doc || !record || record.id !== doc.id || summary) return NONE;
  if (cache?.sentences !== doc.sentences || cache.links !== record.links || cache.text !== record.text) {
    const placed = placeLinks(record.links ?? linksInMarkdown(record.text), doc.sentences);
    cache = { sentences: doc.sentences, links: record.links, text: record.text, placed: placed.length ? placed : NONE };
  }
  return cache.placed;
}

/** How many of the reading's links are behind the listener. */
export const linksRead = (s: PlayerState) => linksPassed(docLinks(s), s);

/** "the docs · example.com", or the address without its scheme for a link written out as a URL. */
export function linkLabel({ url, text }: DocLink): string {
  if (text === url) return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  return `${text} · ${hostOf(url)}`;
}

/** Show each link as a toast once the words it was attached to have been read aloud. */
export function useLinkToasts() {
  useEffect(() => {
    let follower: LinkFollower | null = null;
    const follow = (s: PlayerState) => {
      const next = followLinks(follower, docLinks(s), s);
      follower = next.follower;
      const link = next.heard[next.heard.length - 1];
      if (link && useSettings.getState().linkToasts) toast(linkLabel(link), LINK_TOAST_MS, link.url);
    };
    follow(usePlayer.getState());
    return usePlayer.subscribe(follow);
  }, []);
}
