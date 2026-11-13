import type { Design, DesignMatch } from "./studio";

/**
 * The six settings OmniVoice's voice design accepts (VoiceStudio's
 * `backend/core/describe_voice.py`, `CATEGORY_ORDER`). `hint` says what to
 * write to set one the description left to the model; settings without a hint
 * have a sensible default when unset.
 */
export const DESIGN_SETTINGS = [
  { key: "Gender", label: "Gender", hint: "Say “man” or “woman”." },
  { key: "Age", label: "Age", hint: "Try “young”, “middle-aged”, “elderly” or “45 years old”." },
  { key: "Pitch", label: "Pitch", hint: "Try “deep”, “low-pitched” or “high-pitched”." },
  { key: "Style", label: "Style", unset: "Normal speech", hint: undefined },
  { key: "EnglishAccent", label: "Accent", hint: "Name one, like “American” or “British”." },
  { key: "ChineseDialect", label: "Chinese dialect", unset: "None", hint: undefined },
] as const;

export interface DesignExplanation {
  /** Setting → every phrase in the description that the matcher understood for it, first the one that decided it. */
  heard: Record<string, string[]>;
  /** Parts of the description no setting can express, in reading order. */
  ignored: string[];
}

// Mirrors describe_voice.py: lower-case, straight quotes, collapsed spaces, and the same clause splitter.
const normalize = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[ \t]+/g, " ");
const FRAGMENT = /[^,;.!?()\n，。；！？、]+/g;
// Glue words that carry no voice meaning on their own: trimmed from the ends of an ignored piece so
// "a deep voice" doesn't report "a" and "voice" as unsupported.
const FILLER = new Set(["a", "an", "the", "and", "or", "but", "with", "of", "who", "that", "is", "in", "to", "very", "so", "like", "voice", "voices", "voiced", "sound", "sounds", "sounding", "speaking", "speaks", "talking", "accent", "pitch", "tone"]);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Python's `\b` around Latin phrases; CJK phrases match as plain substrings, as in VoiceStudio. */
const phrasePattern = (phrase: string) => new RegExp(`${/^\w/.test(phrase) ? "(?<!\\w)" : ""}${escape(phrase)}${/\w$/.test(phrase) ? "(?!\\w)" : ""}`, "g");

function trimFiller(piece: string): string {
  const words = piece.trim().split(/\s+/);
  while (words.length && FILLER.has(words[0])) words.shift();
  while (words.length && FILLER.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * What is left of `text` once every matched phrase is cut out, split at clause
 * boundaries and at the cuts. VoiceStudio's own `unmatched` drops a whole clause
 * as soon as any word in it matched, so "overconfident 1970s American game-show
 * host" disappears because of "American"; this keeps "overconfident 1970s" and
 * "game-show host".
 */
export function leftoverPieces(text: string, matched: DesignMatch[]): string[] {
  const normalized = normalize(text);
  const cut = new Array<boolean>(normalized.length).fill(false);
  for (const { phrase } of matched) {
    if (!phrase) continue;
    for (const m of normalized.matchAll(phrasePattern(normalize(phrase)))) cut.fill(true, m.index, m.index + m[0].length);
  }
  const pieces: string[] = [];
  for (const fragment of normalized.matchAll(FRAGMENT)) {
    let piece = "";
    for (let i = fragment.index; i <= fragment.index + fragment[0].length; i++) {
      if (i < fragment.index + fragment[0].length && !cut[i]) { piece += normalized[i]; continue; }
      const kept = trimFiller(piece);
      if (/[\p{L}\p{N}]/u.test(kept)) pieces.push(kept);
      piece = "";
    }
  }
  return pieces;
}

/**
 * Explain an interpreted description: which phrases decided each setting and
 * which parts were ignored. VoiceStudio reports only the first phrase per
 * setting, so a leftover like "deep" (when "booming" already set the pitch)
 * would look unsupported. Each leftover piece is sent back through the same
 * matcher (`describe`) to tell understood-but-redundant words from words no
 * setting can express, keeping VoiceStudio the only source of synonyms.
 */
export async function explainDesign(description: string, design: Design, describe: (text: string) => Promise<Design>): Promise<DesignExplanation> {
  // Servers that don't report `matched` only give us their own clause list.
  if (!design.matched) return { heard: {}, ignored: design.unmatched };
  const heard: Record<string, string[]> = {};
  const isSet = (category: string) => !!design.attrs[category] && design.attrs[category] !== "Auto";
  const credit = (matches: DesignMatch[]) => {
    for (const { category, phrase } of matches) {
      const phrases = (heard[category] ??= []);
      if (!phrases.includes(phrase)) phrases.push(phrase);
    }
  };
  credit(design.matched.filter((m) => isSet(m.category)));
  const ignored: string[] = [];
  let pending = leftoverPieces(description, design.matched);
  // A piece can hide more than one redundant synonym ("deep low-pitched raspy"); a few rounds peel them off.
  for (let round = 0; round < 3 && pending.length; round++) {
    const results = await Promise.all(pending.map((piece) => describe(piece).catch(() => null)));
    const next: string[] = [];
    pending.forEach((piece, i) => {
      // Only settings the full description set count: a phrase VoiceStudio discarded (an accent beside a Chinese dialect) changed nothing.
      const useful = results[i]?.matched?.filter((m) => isSet(m.category)) ?? [];
      if (!useful.length) { ignored.push(piece); return; }
      credit(useful);
      next.push(...leftoverPieces(piece, useful));
    });
    pending = next;
  }
  ignored.push(...pending);
  const order = normalize(description);
  return { heard, ignored: [...new Set(ignored)].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}
