import type { ReadingPlan } from "./prepared";

/**
 * How much room a reading's audio takes on this device, before it is downloaded.
 *
 * Every voice saves MP3, but bitrates and speaking speeds differ, so the size is worked out
 * per voice as bytes per character of narration. It starts from rates measured on the
 * preparation server's saved clips and moves towards what this device has actually saved.
 */

/** Phonon: 64 kbps MP3 at ~14 characters a second (13,500 clips measured). */
const PHONON_BYTES_PER_CHAR = 560;
/** VoiceStudio and the rest: OmniVoice measured ~950. */
const DEFAULT_BYTES_PER_CHAR = 950;
/** Characters saved on this device before its own rate counts as much as the measured one. */
const PRIOR_CHARS = 2_000;

/** Bytes and characters of the clips this device has saved for one voice (one cache key prefix). */
export interface VoiceSample { bytes: number; characters: number }
export type AudioRates = Map<string, VoiceSample>;

const priorFor = (prefix: string) => (prefix.split("|")[0].split(":")[0] === "phonon" ? PHONON_BYTES_PER_CHAR : DEFAULT_BYTES_PER_CHAR);

/** Bytes per character for the voice a cache key prefix names. */
export function bytesPerChar(rates: AudioRates, prefix: string): number {
  const seen = rates.get(prefix) ?? { bytes: 0, characters: 0 };
  return (priorFor(prefix) * PRIOR_CHARS + seen.bytes) / (PRIOR_CHARS + seen.characters);
}

const readingsOf = (plan: ReadingPlan) => (plan.adapted ? [plan.original, plan.adapted] : [plan.original]);
const prefixOf = (key: string) => key.slice(0, key.lastIndexOf("|") + 1);

/** Learn each voice's rate from passage clips whose text is known: those of documents in the library. */
export function learnRates(plans: ReadingPlan[], sizes: Map<string, number>): AudioRates {
  const prefixes = new Set([...sizes.keys()].map(prefixOf));
  const rates: AudioRates = new Map();
  for (const plan of plans) for (const reading of readingsOf(plan)) {
    reading.passages.forEach((passage, i) => {
      for (const prefix of prefixes) {
        const bytes = sizes.get(prefix + reading.passageHashes[i]);
        if (!bytes) continue;
        const sample = rates.get(prefix) ?? rates.set(prefix, { bytes: 0, characters: 0 }).get(prefix)!;
        sample.bytes += bytes;
        sample.characters += passage.text.length;
      }
    });
  }
  return rates;
}

/**
 * Bytes a reading still needs on this device: its narration not saved here yet, at the voice's rate.
 * Audio prepared on the server still counts, since it has to be downloaded.
 */
export function remainingBytes(plan: ReadingPlan, patois: boolean, prefix: string, saved: Pick<Set<string>, "has">, rates: AudioRates): number {
  const reading = patois && plan.adapted ? plan.adapted : plan.original;
  let characters = 0;
  reading.passages.forEach((passage, i) => {
    if (saved.has(prefix + reading.passageHashes[i])) return;
    characters += passage.text.length;
    // Playback can also have saved single sentences of a passage.
    for (let s = passage.start; s < Math.min(passage.end, reading.sentences.length); s++) {
      if (saved.has(prefix + reading.sentenceHashes[s])) characters -= reading.sentences[s].text.length;
    }
  });
  return Math.round(characters * bytesPerChar(rates, prefix));
}
