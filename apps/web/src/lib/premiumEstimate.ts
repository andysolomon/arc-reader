import { STEADY_NARRATION } from "../data/voices";
import { FISH_MODEL, OPENAI_STANDARD_MODEL, OPENAI_STEADY_MODEL } from "../engine/providers";
import type { DocRecord } from "./db";
import { codeKey, readingBlocks, safeCodeSummary } from "./codeBlocks";
import { planPassages, segment } from "./segment";
import { isTokenSpeechModel, priceUsage, type DocSpend, type UsageProvider, type UsageRow } from "./usage";
import { safeVisualDescription, visualKey } from "./visuals";

/**
 * What a premium (paid) reading of a document would cost, before any audio is made.
 *
 * Fish Audio and OpenAI's tts-1 bill exactly by what is sent, so their price follows
 * from the narration playback would send: the same text, code explanations, image
 * descriptions and passage boundaries. gpt-4o-mini-tts bills audio tokens, which depend
 * on how long the voice takes to say it; that rate starts from OpenAI's published
 * estimate and is replaced by what paid generations on this device actually reported.
 */

/** OpenAI estimates gpt-4o-mini-tts at $0.015 a minute: 1,250 audio tokens at $12 / 1M.
 * At ~2.8 words a second and ~6 characters a word that is about 1.2 tokens per character. */
export const PRIOR_OUTPUT_TOKENS_PER_CHAR = 1.2;
/** Text tokens: about four characters each. */
export const INPUT_TOKENS_PER_CHAR = 0.25;
/** Each request also sends the narration instructions, plus message framing. */
export const PRIOR_INPUT_TOKENS_PER_REQUEST = Math.ceil(STEADY_NARRATION.length / 4) + 8;
/** Observed characters needed before learned rates outweigh the published ones. */
const TOKEN_PRIOR_CHARS = 5_000;
const REQUEST_PRIOR = 10;
/** Paid characters before the learned repeat rate counts as much as "each passage once". */
const REPEAT_PRIOR_CHARS = 20_000;
/** Typical lengths of explanations not generated yet (prompts ask for ≤70 and ≤90 words). */
const PRIOR_CODE_SUMMARY_CHARS = 280;
const PRIOR_VISUAL_DESCRIPTION_CHARS = 400;
const LENGTH_PRIOR_COUNT = 3;

export interface Narration {
  /** Speech requests: one per passage */
  requests: number;
  characters: number;
  /** UTF-8 bytes, which Fish Audio bills */
  bytes: number;
  /** Code blocks and pictures whose explanation is not written yet; their length is estimated */
  pendingCode: number;
  pendingVisuals: number;
  /** Characters of those estimated explanations, included in `characters` */
  pendingCharacters: number;
}

export interface Calibration {
  outputTokensPerChar: number;
  inputTokensPerRequest: number;
  /** gpt-4o-mini-tts requests that reported their token usage */
  tokenRequests: number;
  tokenCharacters: number;
  /** Characters paid per unique character generated: regenerations and re-voicing */
  repeat: number;
  repeatCharacters: number;
  codeSummaryChars: number;
  visualDescriptionChars: number;
}

export type PremiumOptionId = "openai-steady" | "openai-standard" | "fish";
export interface PremiumCost {
  id: PremiumOptionId;
  provider: Extract<UsageProvider, "openai" | "fish">;
  model: string;
  label: string;
  /** Expected cost of reading the whole document once in this voice */
  costUsd: number;
  lowUsd: number;
  highUsd: number;
  /** How the price is reached, for the person deciding */
  basis: string;
}

export interface PremiumEstimate {
  narration: Narration;
  options: PremiumCost[];
}

const bytesOf = (text: string) => new TextEncoder().encode(text).length;
const average = (lengths: number[], prior: number) => (prior * LENGTH_PRIOR_COUNT + lengths.reduce((a, b) => a + b, 0)) / (LENGTH_PRIOR_COUNT + lengths.length);

/** The passages playback would request, with explanations that would still be written estimated from `calibration`. */
export function narrationOf(rec: DocRecord, calibration: Pick<Calibration, "codeSummaryChars" | "visualDescriptionChars">, opts: { explainable?: boolean } = {}): Narration {
  const explainable = opts.explainable ?? true;
  const { sentences, paragraphs } = segment(rec.text, rec.codeSummaries, rec.visualDescriptions);
  const passages = planPassages(sentences);
  let characters = 0, bytes = 0, pendingCode = 0, pendingVisuals = 0, pendingCharacters = 0;
  for (const passage of passages) {
    characters += Array.from(passage.text).length;
    bytes += bytesOf(passage.text);
  }
  if (explainable) {
    // A placeholder is spoken today; once explained, its words are replaced by an explanation of typical length.
    for (const paragraph of paragraphs) {
      const pendingKind = paragraph.code && !paragraph.code.summarized && paragraph.code.text.trim() ? "code"
        : paragraph.visual && paragraph.visual.source !== "description" && paragraph.visual.src ? "visual" : null;
      if (!pendingKind) continue;
      const placeholder = paragraph.sentences.map((s) => s.text).join(" ");
      const expected = Math.round(pendingKind === "code" ? calibration.codeSummaryChars : calibration.visualDescriptionChars);
      characters += expected - Array.from(placeholder).length;
      bytes += expected - bytesOf(placeholder);
      pendingCharacters += expected;
      if (pendingKind === "code") pendingCode++; else pendingVisuals++;
    }
  }
  return { requests: passages.length, characters: Math.max(0, characters), bytes: Math.max(0, bytes), pendingCode, pendingVisuals, pendingCharacters };
}

/** Learn from paid usage on this device and explanations already in the library. */
export function calibrate(rows: UsageRow[], spend: Record<string, DocSpend[]>, library: DocRecord[]): Calibration {
  const token = rows.filter((r) => r.provider === "openai" && !r.legacy && isTokenSpeechModel(r.model) && r.inputTokens !== null && r.outputTokens !== null);
  const chars = token.reduce((n, r) => n + r.characters, 0);
  const requests = token.reduce((n, r) => n + r.requests, 0);
  const output = token.reduce((n, r) => n + (r.outputTokens ?? 0), 0);
  const inputOverhead = token.reduce((n, r) => n + (r.inputTokens ?? 0), 0) - chars * INPUT_TOKENS_PER_CHAR;
  const entries = Object.values(spend).flat();
  const paid = entries.reduce((n, e) => n + e.characters, 0);
  const unique = entries.reduce((n, e) => n + e.uniqueCharacters, 0);
  const codeLengths: number[] = [], visualLengths: number[] = [];
  for (const rec of library) {
    for (const text of Object.values(rec.codeSummaries ?? {})) if (safeCodeSummary(text)) codeLengths.push(text.trim().length);
    for (const text of Object.values(rec.visualDescriptions ?? {})) if (safeVisualDescription(text)) visualLengths.push(text.trim().length);
  }
  return {
    outputTokensPerChar: (PRIOR_OUTPUT_TOKENS_PER_CHAR * TOKEN_PRIOR_CHARS + output) / (TOKEN_PRIOR_CHARS + chars),
    inputTokensPerRequest: Math.max(0, (PRIOR_INPUT_TOKENS_PER_REQUEST * REQUEST_PRIOR + inputOverhead) / (REQUEST_PRIOR + requests)),
    tokenRequests: requests,
    tokenCharacters: chars,
    repeat: Math.max(1, (REPEAT_PRIOR_CHARS + paid) / (REPEAT_PRIOR_CHARS + unique)),
    repeatCharacters: paid,
    codeSummaryChars: average(codeLengths, PRIOR_CODE_SUMMARY_CHARS),
    visualDescriptionChars: average(visualLengths, PRIOR_VISUAL_DESCRIPTION_CHARS),
  };
}

/** Cost of one reading with a given provider and model, or null when its price is unknown. */
export function priceNarration(n: Pick<Narration, "requests" | "characters" | "bytes">, provider: "openai" | "fish", model: string, c: Calibration): number | null {
  if (provider === "openai" && isTokenSpeechModel(model)) {
    return priceUsage(provider, model, n.characters, n.bytes, {
      inputTokens: n.characters * INPUT_TOKENS_PER_CHAR + n.requests * c.inputTokensPerRequest,
      outputTokens: n.characters * c.outputTokensPerChar,
    }).costUsd;
  }
  return priceUsage(provider, model, n.characters, n.bytes).costUsd;
}

/** Expected cost of one full reading in a paid voice, including the learned repeat rate; null when unpriced. */
export function readingCost(rec: DocRecord, provider: "openai" | "fish", model: string, c: Calibration, opts: { explainable?: boolean } = {}): number | null {
  const cost = priceNarration(narrationOf(rec, c, opts), provider, model, c);
  return cost === null ? null : cost * c.repeat;
}

const OPTIONS: { id: PremiumOptionId; provider: "openai" | "fish"; model: string; label: string }[] = [
  { id: "openai-steady", provider: "openai", model: OPENAI_STEADY_MODEL, label: "OpenAI · steady narration" },
  { id: "openai-standard", provider: "openai", model: OPENAI_STANDARD_MODEL, label: "OpenAI · standard" },
  { id: "fish", provider: "fish", model: FISH_MODEL, label: "Fish Audio" },
];

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** One full reading per premium option, with a range covering explanations not yet written and learned uncertainty. */
export function estimatePremium(rec: DocRecord, c: Calibration, opts: { explainable?: boolean } = {}): PremiumEstimate {
  const narration = narrationOf(rec, c, opts);
  // Unwritten explanations run from half to 1.6× their usual length; costs are linear in characters and bytes.
  const shift = (factor: number) => ({
    requests: narration.requests,
    characters: Math.max(0, narration.characters + narration.pendingCharacters * (factor - 1)),
    bytes: Math.max(0, narration.bytes + narration.pendingCharacters * (factor - 1)),
  });
  const options = OPTIONS.flatMap((option): PremiumCost[] => {
    const cost = priceNarration(narration, option.provider, option.model, c);
    if (cost === null) return [];
    const low = priceNarration(shift(0.5), option.provider, option.model, c) ?? cost;
    const high = priceNarration(shift(1.6), option.provider, option.model, c) ?? cost;
    const tokens = option.provider === "openai" && isTokenSpeechModel(option.model);
    // The audio-token rate is the uncertain part: ±30% on list estimates, narrowing to ±10% with use.
    const spread = tokens ? 0.1 + 0.2 * TOKEN_PRIOR_CHARS / (TOKEN_PRIOR_CHARS + c.tokenCharacters) : 0;
    const basis = [
      tokens
        ? c.tokenRequests > 0
          ? `${c.outputTokensPerChar.toFixed(2)} audio tokens per character, learned from ${plural(c.tokenRequests, "paid generation")}`
          : "OpenAI's published $0.015 a minute; sharpens as you generate paid audio"
        : option.provider === "fish" ? `${narration.bytes.toLocaleString()} bytes at list price` : `${narration.characters.toLocaleString()} characters at list price`,
      c.repeat > 1.005 && `×${c.repeat.toFixed(2)} for audio you have paid for twice`,
    ].filter(Boolean).join(" · ");
    return [{
      ...option,
      costUsd: cost * c.repeat,
      lowUsd: low * (1 - spread),
      highUsd: high * (1 + spread) * c.repeat,
      basis,
    }];
  });
  return { narration, options };
}

/** Pending explanations, for "includes estimates for …" notes. */
export function pendingNote(n: Narration): string | null {
  const parts = [n.pendingCode && plural(n.pendingCode, "code explanation"), n.pendingVisuals && plural(n.pendingVisuals, "image description")].filter(Boolean);
  return parts.length ? `Includes ${parts.join(" and ")} not written yet` : null;
}

/** Spent so far on a document, across voices on this device. */
export function spentOn(entries: DocSpend[] | undefined): { costUsd: number; unpriced: boolean } | null {
  if (!entries?.length) return null;
  return { costUsd: entries.reduce((n, e) => n + (e.costUsd ?? 0), 0), unpriced: entries.some((e) => e.costUsd === null) };
}

/** Code blocks and pictures in a document, to decide whether explanations are worth preparing. */
export function hasExplainableBlocks(rec: DocRecord): boolean {
  return readingBlocks(rec.text).some((block) => (block.kind === "code" && block.text.trim() && !safeCodeSummary(rec.codeSummaries?.[codeKey(block)]))
    || (block.kind === "visual" && !!block.visual.src && !safeVisualDescription(rec.visualDescriptions?.[visualKey(block.visual)])));
}
