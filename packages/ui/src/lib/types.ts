export interface Voice {
  id: string;
  name: string;
  lang: string;
  tags: string[];
  /** oklch hue; null means local/Piper (uses --bg3) */
  hue: number | null;
  /** Rendering service; used for a consistent service color throughout the UI. */
  engine?: string;
}

export type HighlightMode = "block" | "dim" | "underline";

export interface SentenceLike {
  text: string;
  words: string[];
}

export interface ParagraphLike {
  visual?: { kind: "image" | "diagram"; src: string; alt: string; caption: string; source: "description" | "caption" | "unavailable" };
  code?: { text: string; language: string; summarized: boolean };
  /** A heading rather than body text: its level, 1 for the largest */
  heading?: number;
  sentences: SentenceLike[];
  /** flat index of first sentence in this paragraph */
  start: number;
}
