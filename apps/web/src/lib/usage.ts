import { monthKey } from "./dates";
import { hash } from "./hash";

export const USAGE_KEY = "readaloud:usage";
export const USAGE_EVENT = "readaloud:usage";
export type UsageProvider = "openai" | "fish" | "phonon" | "voicestudio" | "unknown";
export interface TokenUsage { inputTokens: number; outputTokens: number }

/** Daily aggregates contain no text, audio, credentials, or document identifiers. */
export interface UsageRow {
  day: string;
  provider: UsageProvider;
  model: string;
  requests: number;
  characters: number;
  bytes: number;
  audioSeconds: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  pricing: string;
  legacy: boolean;
}
interface Ledger { version: 2; rows: UsageRow[] }
export interface UsageSnapshot { rows: UsageRow[]; storageError: boolean }
const validNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const nullableNumber = (n: unknown) => n === null || validNumber(n);
const validMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
let writeFailed = false;

export function providerFor(engine: string): UsageProvider {
  return engine === "openai" || engine === "fish" || engine === "phonon" ? engine : engine === "unknown" ? "unknown" : "voicestudio";
}

function validRow(row: unknown): row is UsageRow {
  if (!row || typeof row !== "object") return false;
  const r = row as UsageRow;
  return typeof r.day === "string" && validMonth(r.day.slice(0, 7)) && /^\d{4}-\d{2}(?:-(?:0[1-9]|[12]\d|3[01]))?$/.test(r.day)
    && ["openai", "fish", "phonon", "voicestudio", "unknown"].includes(r.provider) && typeof r.model === "string"
    && [r.requests, r.characters, r.bytes, r.audioSeconds].every(validNumber)
    && [r.inputTokens, r.outputTokens, r.costUsd].every(nullableNumber)
    && typeof r.pricing === "string" && typeof r.legacy === "boolean";
}

export function getUsageSnapshot(): UsageSnapshot {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "null");
    if (!raw) return { rows: [], storageError: writeFailed };
    if (raw.version === 2 && Array.isArray(raw.rows)) {
      const rows = raw.rows.filter(validRow);
      return { rows, storageError: writeFailed || rows.length !== raw.rows.length };
    }
    // Preserve the old counter's month, even after rollover. Costs and requests
    // cannot be reconstructed: the old format did not retain models or audio.
    if (validMonth(raw.month) && validNumber(raw.chars)) {
      const rows: UsageRow[] = [];
      const addLegacy = (engine: string, characters: number) => {
        if (characters > 0) rows.push({ day: raw.month, provider: providerFor(engine), model: "Earlier usage", requests: 0,
          characters, bytes: 0, audioSeconds: 0, inputTokens: null, outputTokens: null, costUsd: null,
          pricing: "Only character counts were recorded", legacy: true });
      };
      if (raw.byEngine && typeof raw.byEngine === "object" && !Array.isArray(raw.byEngine)) {
        for (const [engine, chars] of Object.entries(raw.byEngine)) if (validNumber(chars)) addLegacy(engine, chars);
      }
      addLegacy("unknown", Math.max(0, raw.chars - rows.reduce((sum, r) => sum + r.characters, 0)));
      return { rows, storageError: writeFailed };
    }
    return { rows: [], storageError: true };
  } catch {
    return { rows: [], storageError: true };
  }
}

export const isTokenSpeechModel = (model: string) => ["gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-03-20", "gpt-4o-mini-tts-2025-12-15"].includes(model);

/** USD list prices checked 2026-11-05. Store the calculation with each row so
 * future pricing/model changes never reprice historical requests.
 * https://developers.openai.com/api/docs/models/gpt-4o-mini-tts
 * https://developers.openai.com/api/docs/models/tts-1
 * https://developers.openai.com/api/docs/models/tts-1-hd
 * https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
 */
export function priceUsage(provider: UsageProvider, model: string, characters: number, bytes: number, tokens?: TokenUsage): Pick<UsageRow, "costUsd" | "pricing"> {
  if (provider === "openai") {
    if (isTokenSpeechModel(model)) return tokens
      ? { costUsd: (tokens.inputTokens * 0.6 + tokens.outputTokens * 12) / 1_000_000, pricing: "$0.60 / 1M input tokens + $12 / 1M audio output tokens" }
      : { costUsd: null, pricing: "Token usage was not returned" };
    const rate = model === "tts-1" ? 15 : model === "tts-1-hd" ? 30 : null;
    if (rate !== null) return { costUsd: characters * rate / 1_000_000, pricing: `$${rate} / 1M characters` };
  }
  if (provider === "fish") {
    const rate = model === "s2.1-pro-free" ? 0 : ["s2.1-pro", "s2-pro", "s1"].includes(model) ? 15 : null;
    if (rate !== null) return { costUsd: bytes * rate / 1_000_000, pricing: `$${rate} / 1M UTF-8 bytes` };
  }
  return { costUsd: null, pricing: provider === "voicestudio" || provider === "phonon" ? "Server costs are not reported" : "No pricing available for this model" };
}

export interface UsageInput {
  engine: string;
  model: string;
  text: string;
  audioSeconds: number;
  tokens?: TokenUsage;
  /** The library document the audio was generated for; paid generations are also tallied per document. */
  docId?: string;
}

export const DOC_SPEND_KEY = "readaloud:doc-spend";
/** Paid speech generated for one document with one model, on this device. No text is kept, only passage fingerprints. */
export interface DocSpend {
  provider: "openai" | "fish";
  model: string;
  requests: number;
  characters: number;
  /** Characters of passages generated for the first time: the gap to `characters` is audio paid for twice. */
  uniqueCharacters: number;
  /** null once any request could not be priced */
  costUsd: number | null;
  seen: string[];
  updatedAt: number;
}
interface DocSpendLedger { version: 1; docs: Record<string, DocSpend[]> }
const MAX_SPEND_DOCS = 500;
const MAX_SEEN = 4000;

function validSpend(entry: unknown): entry is DocSpend {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as DocSpend;
  return (e.provider === "openai" || e.provider === "fish") && typeof e.model === "string"
    && [e.requests, e.characters, e.uniqueCharacters, e.updatedAt].every(validNumber) && nullableNumber(e.costUsd)
    && Array.isArray(e.seen) && e.seen.every((key) => typeof key === "string");
}

/** Paid generations per document id. Missing or damaged storage reads as empty. */
export function getDocSpend(): Record<string, DocSpend[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(DOC_SPEND_KEY) ?? "null") as DocSpendLedger | null;
    if (raw?.version !== 1 || !raw.docs || typeof raw.docs !== "object") return {};
    return Object.fromEntries(Object.entries(raw.docs).map(([id, list]) => [id, Array.isArray(list) ? list.filter(validSpend) : []]));
  } catch {
    return {};
  }
}

function recordDocSpend(docId: string, provider: "openai" | "fish", row: UsageRow, text: string) {
  const docs = getDocSpend();
  const list = docs[docId] ?? [];
  let entry = list.find((e) => e.provider === provider && e.model === row.model);
  if (!entry) {
    entry = { provider, model: row.model, requests: 0, characters: 0, uniqueCharacters: 0, costUsd: 0, seen: [], updatedAt: 0 };
    list.push(entry);
  }
  const key = hash(text);
  entry.requests += 1;
  entry.characters += row.characters;
  if (!entry.seen.includes(key)) {
    entry.uniqueCharacters += row.characters;
    entry.seen = [...entry.seen, key].slice(-MAX_SEEN);
  }
  entry.costUsd = entry.costUsd === null || row.costUsd === null ? null : entry.costUsd + row.costUsd;
  entry.updatedAt = Date.now();
  docs[docId] = list;
  const kept = Object.entries(docs)
    .sort((a, b) => Math.max(...b[1].map((e) => e.updatedAt), 0) - Math.max(...a[1].map((e) => e.updatedAt), 0))
    .slice(0, MAX_SPEND_DOCS);
  localStorage.setItem(DOC_SPEND_KEY, JSON.stringify({ version: 1, docs: Object.fromEntries(kept) } satisfies DocSpendLedger));
}

/** A successful generation is counted once, including prefetched audio. Cache
 * playback and browser voices never call this. Accounting must not break audio. */
export async function addUsage(input: UsageInput): Promise<void> {
  const now = new Date();
  const provider = providerFor(input.engine);
  const characters = Array.from(input.text).length;
  const bytes = new TextEncoder().encode(input.text).length;
  const tokens = input.tokens && validNumber(input.tokens.inputTokens) && validNumber(input.tokens.outputTokens) ? input.tokens : undefined;
  const row: UsageRow = {
    day: `${monthKey(now)}-${String(now.getDate()).padStart(2, "0")}`, provider, model: input.model,
    requests: 1, characters, bytes, audioSeconds: validNumber(input.audioSeconds) ? input.audioSeconds : 0,
    inputTokens: tokens?.inputTokens ?? null, outputTokens: tokens?.outputTokens ?? null,
    ...priceUsage(provider, input.model, characters, bytes, tokens), legacy: false,
  };
  const save = () => {
    const { rows } = getUsageSnapshot();
    const existing = rows.find((r) => r.day === row.day && r.provider === provider && r.model === row.model && r.pricing === row.pricing
      && !r.legacy && (r.inputTokens === null) === (row.inputTokens === null) && (r.costUsd === null) === (row.costUsd === null));
    if (existing) {
      for (const field of ["requests", "characters", "bytes", "audioSeconds"] as const) existing[field] += row[field];
      for (const field of ["inputTokens", "outputTokens", "costUsd"] as const) {
        if (existing[field] !== null && row[field] !== null) existing[field] += row[field];
      }
    } else rows.push(row);
    localStorage.setItem(USAGE_KEY, JSON.stringify({ version: 2, rows } satisfies Ledger));
    writeFailed = false;
    if (input.docId && (provider === "openai" || provider === "fish")) {
      try { recordDocSpend(input.docId, provider, row, input.text); } catch { /* the monthly ledger is what matters */ }
    }
  };
  try {
    // Serialize cross-tab read/modify/write on supported browsers (HTTPS).
    if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request(USAGE_KEY, save);
    else save();
  } catch {
    writeFailed = true;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USAGE_EVENT));
}

export function summarizeUsage(rows: UsageRow[]) {
  return {
    requests: rows.reduce((n, r) => n + r.requests, 0),
    characters: rows.reduce((n, r) => n + r.characters, 0),
    inputTokens: rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    tokenRequests: rows.filter((r) => r.inputTokens !== null).reduce((n, r) => n + r.requests, 0),
    costUsd: rows.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    unpriced: rows.some((r) => r.costUsd === null),
    priced: rows.some((r) => r.costUsd !== null),
    legacy: rows.some((r) => r.legacy),
  };
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.0001) return "<$0.0001";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 1 ? 4 : 2 }).format(value);
}
