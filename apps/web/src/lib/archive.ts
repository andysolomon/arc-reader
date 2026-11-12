import type { BookContents } from "./book";
import { splitBook } from "./bookText";
import type { DocMeta } from "./db";
import type { Fetched } from "./fetchUrl";
import { hash } from "./hash";
import { ReadError } from "./readError";

/**
 * Books on the Internet Archive. An item's page is a script shell around a page viewer, so the
 * book is read from the item's files instead: the metadata API lists them and says whether they
 * may be downloaded, and scanned books carry their full text as one plain file. Books that are
 * only lent keep that file locked; those are reported, not worked around.
 */

const API = "https://archive.org";
/** Complete works run to a few megabytes; more than this is not one book */
const MAX_BYTES = 12 * 1024 * 1024;

export const LENT_ONLY = "Archive.org only lends this book, so its text can't be imported. Look for an edition that is free to download.";
const NO_TEXT = "Archive.org has no plain text for this book";
const TOO_LARGE = "That is too much text to import as one book";
const UNAVAILABLE = "Archive.org didn't send this book's text. Try again in a moment.";

type Field = string | string[] | undefined;

interface ItemFile {
  name: string;
  format?: string;
  size?: string;
  private?: string | boolean;
}

/** What https://archive.org/metadata/<id> returns; `{}` for an item that doesn't exist */
export interface ArchiveItem {
  metadata?: Record<string, Field>;
  files?: ItemFile[];
}

const first = (value: Field) => (Array.isArray(value) ? value[0] : value) ?? "";
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const locked = (file: ItemFile) => file.private === true || file.private === "true";

/** The item a link points at, and the file when the link names one: /details/<id>, /download/<id>/<file>, /stream/<id>… */
export function archiveItem(url: string): { id: string; file?: string } | null {
  try {
    const u = new URL(url);
    if (!/^(?:www\.)?archive\.org$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(details|stream|download|embed)\/([^/]+)(?:\/(.+))?$/);
    if (!m) return null;
    return { id: decodeURIComponent(m[2]), ...(m[1] === "download" && m[3] ? { file: decodeURIComponent(m[3]) } : {}) };
  } catch {
    return null;
  }
}

const isText = (file: ItemFile) => file.format === "DjVuTXT" || file.format === "Text" || (/\.txt$/i.test(file.name) && !/_meta\.txt$/i.test(file.name));

/** The item's full text: the file the link named, else the scan's OCR, else the largest transcription. */
export function textFile(files: ItemFile[], named?: string): ItemFile | undefined {
  const texts = files.filter(isText).sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0));
  return texts.find((file) => file.name === named) ?? texts.find((file) => file.format === "DjVuTXT") ?? texts[0];
}

/** "Dumas, Alexandre, 1802-1870" → "Alexandre Dumas" */
function person(creator: string): string {
  const name = tidy(creator).replace(/,?\s*(?:(?:b|d|fl|ca)\.\s*)?\d{3,4}\??\s*(?:-\s*(?:\d{3,4}\??)?)?\.?$/, "");
  const parts = name.split(/,\s*/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

function catalogue(id: string, metadata: Record<string, Field>): { title: string; meta: DocMeta } {
  const volume = tidy(first(metadata.volume));
  const name = tidy(first(metadata.title)) || id;
  const creators = ([] as string[]).concat(metadata.creator ?? []).slice(0, 3).map(person).filter(Boolean);
  const description = tidy(first(metadata.description).replace(/<[^>]+>/g, " ")).slice(0, 2000);
  const published = tidy(first(metadata.date)).slice(0, 10);
  const meta: DocMeta = {
    url: `${API}/details/${encodeURIComponent(id)}`,
    ...(creators.length ? { author: creators.join(", ") } : {}),
    ...(published ? { published } : {}),
    site: "Internet Archive",
    ...(description ? { description } : {}),
  };
  // A set's volumes are separate items that share one title.
  return { title: volume && !/\bvol/i.test(name) ? `${name}, volume ${volume}` : name, meta };
}

/** Straight from the Archive, which allows it; through the app's server where the network in between doesn't. */
async function get(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    const r = await fetch(url, { signal });
    if (r.ok) return r;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  const r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

/** Scans are UTF-8; older transcriptions are Latin-1, which would otherwise lose every accent. */
function decode(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The book as the app reads any page: its first chapter, with the others to be added from the offer. */
export function archiveBook(id: string, metadata: Record<string, Field>, text: string): Fetched {
  const { title, meta } = catalogue(id, metadata);
  const parts = splitBook(text);
  if (!parts.length) throw new ReadError(NO_TEXT);
  const book: BookContents | undefined = parts.length > 1 ? {
    id: `book:${hash(`archive.org/${id}`)}`,
    title,
    chapters: parts.map((part) => ({ url: meta.url!, title: part.title, text: part.text })),
    index: 0,
    meta,
  } : undefined;
  return { title, text: parts[0].text, domain: "archive.org", meta, links: [], ...(book ? { book } : {}) };
}

/**
 * The book behind an Internet Archive link, or null when the link is to something else there
 * (audio, video, a collection), which is then read like any other page.
 */
export async function fetchArchiveBook(url: string, signal?: AbortSignal): Promise<Fetched | null> {
  const link = archiveItem(url);
  if (!link) return null;
  const item = await (await get(`${API}/metadata/${encodeURIComponent(link.id)}`, signal)).json() as ArchiveItem;
  if (!item.metadata || first(item.metadata.mediatype) !== "texts") return null;
  const file = textFile(item.files ?? [], link.file);
  if (first(item.metadata["access-restricted-item"]) === "true" || (file && locked(file))) throw new ReadError(LENT_ONLY);
  if (!file) throw new ReadError(NO_TEXT);
  if (Number(file.size ?? 0) > MAX_BYTES) throw new ReadError(TOO_LARGE);
  try {
    const r = await get(`${API}/download/${encodeURIComponent(link.id)}/${file.name.split("/").map(encodeURIComponent).join("/")}`, signal);
    return archiveBook(link.id, item.metadata, decode(await r.arrayBuffer()));
  } catch (e) {
    // The Archive's storage servers fail now and then; the viewer's page would only import as clutter.
    if (e instanceof ReadError || signal?.aborted) throw e;
    throw new ReadError(UNAVAILABLE);
  }
}
