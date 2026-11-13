import { JAMAICAN_PATOIS_VOICE_ID, type Voice } from "../data/voices";
import { cacheKey } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
import type { DocRecord } from "./db";
import { hasPatois } from "./patois";
import { planPassages, segment, type Passage, type Sentence } from "./segment";

export interface PreparedVoice {
  voiceId: string;
  name: string;
  engine: string;
  fraction: number;
}

interface Reading { sentences: Sentence[]; passages: Passage[] }
/** A document's passages as playback plans them, worked out once for every voice. */
export interface ReadingPlan { original: Reading; adapted: Reading | null }

const reading = (text: string, rec: DocRecord): Reading => {
  const { sentences } = segment(text, rec.codeSummaries, rec.visualDescriptions);
  return { sentences, passages: planPassages(sentences) };
};

export function planReading(rec: DocRecord): ReadingPlan {
  return { original: reading(rec.text, rec), adapted: hasPatois(rec) ? reading(rec.patois!.text, rec) : null };
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
export function preparedVoices(rec: DocRecord, voices: Voice[], keys: Set<string>, openaiModel: string, shared: Set<string> = new Set(), plan = planReading(rec)): PreparedVoice[] {
  return voices.flatMap((voice) => {
    if (voice.engine === LOCAL_ENGINE) return [];
    const patois = voice.id === JAMAICAN_PATOIS_VOICE_ID;
    if (patois && !plan.adapted) return [];
    const { sentences, passages } = patois ? plan.adapted! : plan.original;
    const own = passages.filter((passage) => !shared.has(passage.text));
    // A document made only of shared passages (a duplicate import) is measured by all of them.
    const counted = own.length ? own : passages;
    const key = (text: string) => cacheKey({ text, voice: voice.id, engine: voice.engine, openaiModel });
    let total = 0, ready = 0;
    for (const passage of counted) {
      const cached = keys.has(key(passage.text));
      for (const sentence of sentences.slice(passage.start, passage.end)) {
        const weight = sentence.words.length;
        total += weight;
        if (cached || keys.has(key(sentence.text))) ready += weight;
      }
    }
    return ready && total ? [{ voiceId: voice.id, name: voice.name, engine: voice.engine, fraction: ready / total }] : [];
  });
}
