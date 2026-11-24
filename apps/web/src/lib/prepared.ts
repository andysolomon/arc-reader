import { JAMAICAN_PATOIS_VOICE_ID, type Voice } from "../data/voices";
import { cacheKeyPrefix } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
import type { DocRecord } from "./db";
import { hash } from "./hash";
import { hasPatois } from "./patois";
import { planPassages, segment, type Passage, type Sentence } from "./segment";

export interface PreparedVoice {
  voiceId: string;
  name: string;
  engine: string;
  /** 0..1 of the reading made, saved on this device or on the preparation server */
  fraction: number;
  /** 0..1 of it saved on this device itself, when the library measured that */
  stored?: number;
}

interface Reading {
  sentences: Sentence[];
  passages: Passage[];
  /** Text hashes, as cache keys end, worked out once rather than once per voice. */
  passageHashes: string[];
  sentenceHashes: string[];
}
/** A document's passages as playback plans them, worked out once for every voice. */
export interface ReadingPlan { original: Reading; adapted: Reading | null }

const reading = (text: string, rec: DocRecord): Reading => {
  const { sentences } = segment(text, rec.codeSummaries, rec.visualDescriptions);
  const passages = planPassages(sentences);
  return { sentences, passages, passageHashes: passages.map((p) => hash(p.text)), sentenceHashes: sentences.map((s) => hash(s.text)) };
};

// The library refreshes every few seconds; re-segmenting every document each time
// kept the page busy for seconds. A plan stands until the text it was made from changes.
const plans = new Map<string, { inputs: unknown[]; plan: ReadingPlan }>();
const sameInputs = (a: unknown[], b: unknown[]) => a.every((value, i) => value === b[i]);

export function planReading(rec: DocRecord): ReadingPlan {
  const adapted = hasPatois(rec);
  const inputs = [rec.text, adapted ? rec.patois!.text : null, JSON.stringify(rec.codeSummaries ?? null), JSON.stringify(rec.visualDescriptions ?? null)];
  const saved = plans.get(rec.id);
  if (saved && sameInputs(saved.inputs, inputs)) return saved.plan;
  const plan = { original: reading(rec.text, rec), adapted: adapted ? reading(rec.patois!.text, rec) : null };
  plans.set(rec.id, { inputs, plan });
  return plan;
}

/**
 * Passages that more than one document reads word for word, such as a book's
 * "code example skipped" notice, its tab labels and its numbered headings.
 */
export function sharedPassages(plans: ReadingPlan[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const plan of plans) {
    for (const text of new Set(plan.original.passages.map((passage) => passage.text))) {
      if (seen.has(text)) shared.add(text);
      else seen.add(text);
    }
  }
  return shared;
}

/**
 * Coverage follows the same text, model and passage boundaries as playback.
 * Passages other documents share are left out, so audio saved for a sibling
 * chapter's boilerplate doesn't make this one look partly prepared.
 */
export function preparedVoices(rec: DocRecord, voices: Voice[], keys: Set<string>, openaiModel: string, shared: Set<string> = new Set(), plan = planReading(rec), device?: Set<string>): PreparedVoice[] {
  return voices.flatMap((voice) => {
    if (voice.engine === LOCAL_ENGINE) return [];
    const patois = voice.id === JAMAICAN_PATOIS_VOICE_ID;
    if (patois && !plan.adapted) return [];
    const prefix = cacheKeyPrefix({ voice: voice.id, engine: voice.engine, openaiModel });
    if (!hasPrefix(keys, prefix)) return [];
    const { sentences, passages, passageHashes, sentenceHashes } = patois ? plan.adapted! : plan.original;
    const own = passages.flatMap((passage, i) => shared.has(passage.text) ? [] : [i]);
    // A document made only of shared passages (a duplicate import) is measured by all of them.
    const counted = own.length ? own : passages.map((_, i) => i);
    let total = 0, ready = 0, here = 0;
    for (const i of counted) {
      const passage = passages[i];
      const cached = keys.has(prefix + passageHashes[i]);
      const onDevice = !!device?.has(prefix + passageHashes[i]);
      for (let s = passage.start; s < Math.min(passage.end, sentences.length); s++) {
        const weight = sentences[s].words.length;
        total += weight;
        if (cached || keys.has(prefix + sentenceHashes[s])) ready += weight;
        if (onDevice || device?.has(prefix + sentenceHashes[s])) here += weight;
      }
    }
    if (!ready || !total) return [];
    return [{ voiceId: voice.id, name: voice.name, engine: voice.engine, fraction: ready / total, ...(device ? { stored: here / total } : {}) }];
  });
}

// Most voices have nothing saved, so look up which voices do once per key set rather than hashing every sentence for each.
const prefixesOf = new WeakMap<Set<string>, { size: number; prefixes: Set<string> }>();
function hasPrefix(keys: Set<string>, prefix: string) {
  let known = prefixesOf.get(keys);
  if (!known || known.size !== keys.size) {
    known = { size: keys.size, prefixes: new Set([...keys].map((key) => key.slice(0, key.lastIndexOf("|") + 1))) };
    prefixesOf.set(keys, known);
  }
  return known.prefixes.has(prefix);
}
