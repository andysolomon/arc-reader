import { PRACTICE_PASSAGES } from "../../data/practicePassages";
import { nprReadingScript } from "../readingScript";
import { bandInfo, type Band } from "./bands";
import { fits, screenPassage } from "./screen";

export interface Passage {
  id: string;
  band: Band;
  text: string;
  title: string;
  url: string;
  source: "npr" | "public-domain";
  author?: string;
}

/** NPR stories mostly read at a high-school or college level; the other bands use the bundled passages. */
const NPR_BANDS: Band[] = ["9-12", "college"];
/** How many NPR passages Jev may turn down before a bundled one is used instead. */
const NPR_TRIES = 2;

export function bundledPassage(band: Band, avoid: Iterable<string> = [], random = Math.random): Passage {
  const pool = PRACTICE_PASSAGES.filter((p) => p.band === band);
  const skip = new Set(avoid);
  const fresh = pool.filter((p) => !skip.has(p.id));
  const from = fresh.length ? fresh : pool;
  const p = from[Math.floor(random() * from.length)];
  return { ...p, source: "public-domain" };
}

/**
 * A passage for `band`. For the bands NPR suits, about half the time a current NPR passage is
 * tried and kept only if Jev agrees it fits the band and is suitable; anything that goes wrong
 * (no Jev key, NPR down, nothing fits) falls back to a bundled public-domain passage.
 */
export async function nextPassage(band: Band, { avoid = [], signal, random = Math.random }: { avoid?: string[]; signal?: AbortSignal; random?: () => number } = {}): Promise<Passage> {
  if (NPR_BANDS.includes(band) && random() < 0.5) {
    const { min, max } = bandInfo(band);
    let last: string | undefined = avoid.at(-1);
    for (let i = 0; i < NPR_TRIES; i++) {
      try {
        const script = await nprReadingScript({ avoid: last, signal, random, words: { min, max } });
        last = script.url;
        if (avoid.includes(script.url)) continue;
        if (fits(await screenPassage(script.text, signal), band)) {
          return { id: script.url, band, text: script.text, title: script.title, url: script.url, source: "npr" };
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        break;
      }
    }
  }
  return bundledPassage(band, avoid, random);
}
