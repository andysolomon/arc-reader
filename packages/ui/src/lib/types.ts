export interface Voice {
  id: string;
  name: string;
  lang: string;
  tags: string[];
  /** oklch hue; null means local/Piper (uses --bg3) */
  hue: number | null;
}

export type HighlightMode = "block" | "dim" | "underline";

export interface SentenceLike {
  text: string;
  words: string[];
}

export interface ParagraphLike {
  sentences: SentenceLike[];
  /** flat index of first sentence in this paragraph */
  start: number;
}
