/** What /api/covers answers with. The app holds these as it gets them; the server checks its own copies. */

/** `blocked`: nothing under the heading to draw from, so no art is made up for it. */
export type CoverStatus = "queued" | "generating" | "ready" | "failed" | "blocked";

export interface CoverEntry {
  key: string;
  kind: "article" | "section";
  /** The article's title, or the heading as written */
  heading: string;
  /** Headings from the outermost section down to this one */
  path: string[];
  level: number;
  /** Which of the document's headings this is, from 0; -1 for the article */
  ordinal: number;
  parent: string;
  status: CoverStatus;
  /** The art, once it is ready: a picture with no lettering, set under the title by the app */
  url?: string;
  /** What the art shows */
  alt: string;
  error?: string;
  updated: number;
}

export interface DocCovers {
  docId: string;
  style: string;
  /** Headings in the text these covers were made from, so the Reader can tell a rewrite apart */
  headings: number;
  covers: CoverEntry[];
}

/** One line per document for the Library: its article cover, and how its sections are coming on. */
export interface CoverSummary {
  status: CoverStatus;
  url?: string;
  pending: number;
  failed: number;
}

export interface CoverLibrary {
  /** The server has a key to draw with and covers are switched on */
  configured: boolean;
  /** Today's limit on new art is reached; what is queued waits */
  paused: boolean;
  docs: Record<string, CoverSummary>;
}
