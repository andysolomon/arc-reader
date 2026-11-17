import type { DocBook, DocMeta, DocRecord, DocSource } from "./db";
import { uid } from "./hash";
import { linksInMarkdown, uniqueLinks, type DocLink } from "./links";
import { catalogue } from "./postTitle";
import { titleFrom } from "./segment";

export interface NewDocument {
  text: string;
  title?: string;
  source: DocSource;
  domain?: string;
  voice?: string | null;
  meta?: DocMeta;
  links?: DocLink[];
  book?: DocBook;
}

/** A document as it is first saved, whether the app or the server adds it. */
export function newDocRecord({ text, title, source, domain, voice = null, meta, links = [], book }: NewDocument, now = Date.now()): DocRecord {
  // Page links come from the HTML; links written into the text itself count too.
  const allLinks = uniqueLinks([...links, ...linksInMarkdown(text)]);
  // X's page title carries the author and site; keep them in their own fields instead.
  const named = title?.trim() ? catalogue({ title, domain, meta }) : null;
  if (named?.author && !meta?.author) meta = { ...meta, author: named.author };
  return {
    id: uid(),
    title: named?.title || titleFrom(text),
    text,
    source,
    domain: domain ?? (source === "paste" ? "Pasted text" : source === "sample" ? "Sample" : source === "share" ? "Shared" : "Text"),
    voice,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
    ...(book ? { book } : {}),
    chars: text.length,
    ...(allLinks.length ? { links: allLinks } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
