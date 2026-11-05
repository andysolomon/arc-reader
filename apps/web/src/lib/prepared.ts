import { JAMAICAN_PATOIS_VOICE_ID, type Voice } from "../data/voices";
import { cacheKey } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
import type { DocRecord } from "./db";
import { hasPatois } from "./patois";
import { planPassages, segment } from "./segment";

export interface PreparedVoice {
  voiceId: string;
  name: string;
  fraction: number;
}

/** Coverage follows the same text, model and passage boundaries as playback. */
export function preparedVoices(rec: DocRecord, voices: Voice[], keys: Set<string>, openaiModel: string): PreparedVoice[] {
  const original = segment(rec.text).sentences;
  const adapted = hasPatois(rec) ? segment(rec.patois!.text).sentences : null;
  const originalPassages = planPassages(original);
  const adaptedPassages = adapted ? planPassages(adapted) : [];
  return voices.flatMap((voice) => {
    if (voice.engine === LOCAL_ENGINE) return [];
    const patois = voice.id === JAMAICAN_PATOIS_VOICE_ID;
    if (patois && !adapted) return [];
    const sentences = patois ? adapted! : original;
    const passages = patois ? adaptedPassages : originalPassages;
    const key = (text: string) => cacheKey({ text, voice: voice.id, engine: voice.engine, openaiModel });
    let total = 0, ready = 0;
    for (const passage of passages) {
      const cached = keys.has(key(passage.text));
      for (const sentence of sentences.slice(passage.start, passage.end)) {
        const weight = sentence.words.length;
        total += weight;
        if (cached || keys.has(key(sentence.text))) ready += weight;
      }
    }
    return ready && total ? [{ voiceId: voice.id, name: voice.name, fraction: ready / total }] : [];
  });
}
