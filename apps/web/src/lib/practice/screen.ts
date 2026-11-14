import { JEV_MODEL } from "../category";
import { BANDS, type Band } from "./bands";

/**
 * Jev reads an NPR passage before anyone is asked to read it aloud: which level it suits, and
 * whether it is unsuitable for a 12-year-old. Verdicts are kept per passage in localStorage.
 */
export const LEVEL_SURE = 0.7;
export const UNSUITABLE_MAX = 0.3;
const CACHE = "readaloud:practice-screening";
const CACHE_LIMIT = 200;

export interface Screening { level: Band | null; confidence: number; unsuitable: number }

export function screeningRequest(passage: string) {
  return {
    model: JEV_MODEL,
    state: { passage },
    questions: {
      level: {
        type: "choice",
        instructions: "Which reader is this passage best suited to read aloud, judged by vocabulary, sentence length and background knowledge?",
        criteria: {
          "6-8": "Grades 6–8: common words, short sentences, concrete ideas",
          "9-12": "Grades 9–12: some uncommon words and longer sentences",
          college: "College: dense argument, specialist or abstract vocabulary",
          advanced: "Advanced: very long or intricate sentences and rare vocabulary",
        } satisfies Record<Band, string>,
      },
      unsuitable: {
        type: "noul",
        instructions: "Does this passage contain graphic violence, sexual content, slurs or distressing detail unsuitable for a 12-year-old?",
      },
    },
  };
}

interface JevAnswer { choice?: unknown; confidence?: unknown; noul?: unknown }
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function interpretScreening(data: { answers?: Record<string, JevAnswer> } | null): Screening {
  const level = data?.answers?.level, unsuitable = data?.answers?.unsuitable?.noul;
  if (!probability(unsuitable) || !BANDS.some((b) => b.id === level?.choice)) throw new Error("Jev didn't answer about the passage.");
  return { level: level!.choice as Band, confidence: probability(level!.confidence) ? level!.confidence : 0, unsuitable };
}

/** Whether a screened passage may be read at `band`. */
export const fits = (s: Screening, band: Band) => s.level === band && s.confidence >= LEVEL_SURE && s.unsuitable <= UNSUITABLE_MAX;

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
function readCache(): Record<string, Screening> {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? "{}") as Record<string, Screening>; } catch { return {}; }
}

export async function screenPassage(passage: string, signal?: AbortSignal): Promise<Screening> {
  const key = hash(passage);
  const cached = readCache()[key];
  if (cached) return cached;
  const response = await fetch("/api/jev/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(screeningRequest(passage)),
    signal: signal ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Jev couldn't screen the passage (HTTP ${response.status}).`);
  const screening = interpretScreening(await response.json().catch(() => null));
  const cache = readCache();
  cache[key] = screening;
  const keys = Object.keys(cache);
  for (const old of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete cache[old];
  try { localStorage.setItem(CACHE, JSON.stringify(cache)); } catch { /* full storage only costs a re-check */ }
  return screening;
}
