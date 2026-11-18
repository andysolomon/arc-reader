/**
 * X (Twitter) posts render entirely in JavaScript, so a plain page fetch gets
 * boilerplate instead of the post. FxTwitter's public API returns the post,
 * including long-form X Articles, as JSON; this turns it into a small HTML
 * page the reader's normal extraction understands (title, author, date,
 * headings, lists, captioned images, links). A post's video is shown by its poster frame;
 * what is said in it is transcribed on request (vite.transcribe.ts).
 */

import { videoLength, xPostId } from "./src/lib/videoTranscript";

export { xPostId };

export const FXTWITTER_API = "https://api.fxtwitter.com";

interface Block { type: string; text: string; entityRanges?: { key: number | string; offset: number; length: number }[] }
interface Entity { type: string; data?: Record<string, unknown> }
interface Media { media_id?: string; media_info?: { original_img_url?: string; preview_image?: { original_img_url?: string } } }
interface Article {
  title?: string;
  preview_text?: string;
  cover_media?: Media;
  media_entities?: Media[];
  content?: { blocks?: Block[]; entityMap?: Record<string, Entity> | { key: string; value: Entity }[] };
}
interface Photo { url?: string; altText?: string }
interface Video {
  url?: string;
  thumbnail_url?: string;
  /** Seconds */
  duration?: number;
  /** "gif" for a silent loop */
  type?: string;
  formats?: { url?: string; bitrate?: number; container?: string }[];
}
export interface FxTweet {
  url?: string;
  text?: string;
  created_timestamp?: number;
  author?: { name?: string; screen_name?: string };
  media?: { photos?: Photo[]; videos?: Video[] };
  quote?: FxTweet;
  article?: Article;
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const attr = (value: string) => `"${escape(value)}"`;

function entityMap(article: Article): Map<string, Entity> {
  const map = article.content?.entityMap ?? {};
  const entries = Array.isArray(map) ? map.map((e) => [String(e.key), e.value] as const) : Object.entries(map);
  return new Map(entries);
}

const mediaUrl = (media?: Media) => media?.media_info?.original_img_url || media?.media_info?.preview_image?.original_img_url || "";

function figure(src: string, caption = "", alt = ""): string {
  if (!src) return "";
  return `<figure><img src=${attr(src)}${alt ? ` alt=${attr(alt)}` : ""}>${caption ? `<figcaption>${escape(caption)}</figcaption>` : ""}</figure>`;
}

/** Block text with LINK entities as anchors, so the post's hyperlinks are kept. */
function inline(block: Block, entities: Map<string, Entity>): string {
  const links = (block.entityRanges ?? [])
    .map((r) => ({ ...r, url: entities.get(String(r.key))?.type === "LINK" ? String(entities.get(String(r.key))?.data?.url ?? "") : "" }))
    .filter((r) => r.url)
    .sort((a, b) => a.offset - b.offset);
  let html = "", at = 0;
  for (const link of links) {
    if (link.offset < at) continue;
    html += escape(block.text.slice(at, link.offset));
    html += `<a href=${attr(link.url)}>${escape(block.text.slice(link.offset, link.offset + link.length))}</a>`;
    at = link.offset + link.length;
  }
  return html + escape(block.text.slice(at));
}

const TAGS: Record<string, string> = {
  "header-one": "h2", "header-two": "h2", "header-three": "h3", "header-four": "h4",
  blockquote: "blockquote", "code-block": "pre",
};

function articleBody(article: Article): string {
  const entities = entityMap(article);
  const media = new Map((article.media_entities ?? []).map((m) => [String(m.media_id), m]));
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const block of article.content?.blocks ?? []) {
    const listType = block.type === "unordered-list-item" ? "ul" : block.type === "ordered-list-item" ? "ol" : null;
    if (listType !== list) closeList();
    if (listType) {
      if (!list) out.push(`<${listType}>`);
      list = listType;
      out.push(`<li>${inline(block, entities)}</li>`);
      continue;
    }
    if (block.type === "atomic") {
      for (const range of block.entityRanges ?? []) {
        const entity = entities.get(String(range.key));
        const data = entity?.data ?? {};
        if (entity?.type === "MEDIA") {
          const caption = typeof data.caption === "string" ? data.caption : "";
          const items = Array.isArray(data.mediaItems) ? data.mediaItems as { mediaId?: string }[] : [];
          for (const item of items) out.push(figure(mediaUrl(media.get(String(item.mediaId))), caption));
        } else if (typeof data.markdown === "string") {
          out.push(`<pre>${escape(data.markdown)}</pre>`);
        }
      }
      continue;
    }
    if (!block.text.trim()) continue;
    const tag = TAGS[block.type] ?? "p";
    out.push(`<${tag}>${inline(block, entities)}</${tag}>`);
  }
  closeList();
  return out.join("");
}

/** Where X serves video files from: the only host a video is ever downloaded from. */
const VIDEO_HOST = "video.twimg.com";

export interface XVideo {
  /** The smallest MP4 of it: the sound is the same in every size */
  url: string;
  seconds: number;
}

const isVideo = (video: Video) => video.type !== "gif" && (video.duration ?? 0) > 0;

function videoFile(input: string | undefined): string {
  try {
    const url = new URL(input ?? "");
    return url.protocol === "https:" && url.hostname === VIDEO_HOST && /\.mp4$/i.test(url.pathname) ? url.href : "";
  } catch { return ""; }
}

/** The post's own video with sound, when it has one; the first of several. */
export function xPostVideo(tweet: FxTweet): XVideo | null {
  const video = (tweet.media?.videos ?? []).find(isVideo);
  if (!video) return null;
  const sizes = (video.formats ?? []).filter((f) => f.container === "mp4" && videoFile(f.url)).sort((a, b) => (a.bitrate ?? Infinity) - (b.bitrate ?? Infinity));
  const url = videoFile(sizes[0]?.url) || videoFile(video.url);
  return url ? { url, seconds: video.duration! } : null;
}

function postBody(tweet: FxTweet): string {
  const paragraphs = (tweet.text ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`);
  const photos = (tweet.media?.photos ?? []).map((p) => figure(p.url ?? "", "", p.altText ?? ""));
  // The poster frame stands for the video; without it a post that is only a video has nothing to open.
  const videos = (tweet.media?.videos ?? []).filter(isVideo).map((v) => figure(v.thumbnail_url ?? "", `Video, ${videoLength(v.duration!)}`));
  const quote = tweet.quote ? `<blockquote><p>${escape(tweet.quote.author?.name ?? "Quoted post")}:</p>${postBody(tweet.quote)}</blockquote>` : "";
  return paragraphs.join("") + photos.join("") + videos.join("") + quote;
}

export function xPostHtml(tweet: FxTweet): string {
  const name = tweet.author?.name || (tweet.author?.screen_name ? `@${tweet.author.screen_name}` : "Someone");
  const article = tweet.article;
  const firstLine = (tweet.text ?? "").split("\n")[0].trim();
  const headline = article?.title || (firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine);
  // The author has its own field; the title is the post's own words.
  const title = headline || `Post by ${name}`;
  const published = tweet.created_timestamp ? new Date(tweet.created_timestamp * 1000).toISOString() : "";
  const description = article?.preview_text || tweet.text || "";
  const body = article
    ? `<h1>${escape(article.title ?? "")}</h1>${figure(mediaUrl(article.cover_media))}${articleBody(article)}`
    : postBody(tweet);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>`
    + `<meta property="og:title" content=${attr(title)}>`
    + `<meta property="og:site_name" content="X">`
    + `<meta name="author" content=${attr(name)}>`
    + (published ? `<meta property="article:published_time" content=${attr(published)}>` : "")
    + (description ? `<meta property="og:description" content=${attr(description)}>` : "")
    + `</head><body><article>${body}</article></body></html>`;
}
