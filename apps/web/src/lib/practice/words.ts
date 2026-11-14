/**
 * A passage split for marking: each whitespace-separated token keeps its punctuation outside the
 * word, so a verdict can underline "Tuckahoe" and leave the comma after it alone.
 */
export interface Token {
  /** Index among the passage's words, the same index the judge's questions use. */
  index: number;
  /** Punctuation before the word, such as an opening quote. */
  pre: string;
  word: string;
  /** Punctuation after the word. */
  post: string;
  /** Whether a space comes before it; words joined by a dash ("orphan—to") have none. */
  space: boolean;
}

const EDGE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

/** Old typesetting's double hyphen as the dash it stands for. */
export const displayText = (text: string) => text.replace(/--/g, "—");

export function tokens(text: string): Token[] {
  const pieces = displayText(text).split(/\s+/).filter(Boolean)
    // A dash between two words separates them, as a space would.
    .flatMap((chunk) => chunk.split(/(?<=—)(?=[\p{L}\p{N}])/u).map((raw, i) => ({ raw, space: i === 0 })));
  return pieces.map(({ raw, space }, index) => {
    const [, pre = "", word = "", post = ""] = raw.match(EDGE) ?? [];
    // A token with no letters or digits (a lone dash) is all punctuation.
    return word ? { index, pre, word, post, space } : { index, pre: "", word: raw, post: "", space };
  });
}

/** How a word is filed in the word bank: lower case, curly apostrophes straightened. */
export const wordKey = (word: string) => word.normalize("NFC").replace(/[’‘]/g, "'").toLowerCase();

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
