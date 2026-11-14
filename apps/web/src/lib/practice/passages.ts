import { PRACTICE_PASSAGES } from "../../data/practicePassages";
import { nprReadingScript } from "../readingScript";
import { bandInfo, type Band } from "./bands";
import { fits, screenPassage } from "./screen";

export interface Passage {
  id: string;
  band: Band;
  /** Always the source's own words: passages are never rewritten. */
  text: string;
  title: string;
  url: string;
  source: "npr" | "public-domain";
  author?: string;
}

/** Bands an NPR passage can serve; Advanced reads the bundled passages only. */
const NPR_BANDS: Band[] = ["6-8", "9-12", "college"];
/** How many NPR stories may be turned down before a bundled passage is used instead. */
const NPR_TRIES = 2;

export function bundledPassage(band: Band, avoid: Iterable<string> = [], random = Math.random): Passage {
  const pool = PRACTICE_PASSAGES.filter((p) => p.band === band);
  const skip = new Set(avoid);
  const fresh = pool.filter((p) => !skip.has(p.id));
  const from = fresh.length ? fresh : pool;
  const p = from[Math.floor(random() * from.length)];
  return { ...p, source: "public-domain" };
}

export interface PassageDeps {
  npr: typeof nprReadingScript;
  screen: typeof screenPassage;
}
const DEPS: PassageDeps = { npr: nprReadingScript, screen: screenPassage };

/**
 * A passage for `band`. For the bands NPR suits, about half the time a current NPR passage is
 * tried and kept, exactly as written, only if Jev agrees it fits the band and is suitable.
 * Anything that goes wrong (no Jev key, NPR down, nothing fits) falls back to a bundled
 * public-domain passage.
 */
export async function nextPassage(band: Band, { avoid = [], signal, random = Math.random, deps = DEPS }: { avoid?: string[]; signal?: AbortSignal; random?: () => number; deps?: PassageDeps } = {}): Promise<Passage> {
  if (NPR_BANDS.includes(band) && random() < 0.5) {
    const { min, max } = bandInfo(band);
    let last: string | undefined = avoid.at(-1);
    for (let i = 0; i < NPR_TRIES; i++) {
      try {
        const script = await deps.npr({ avoid: last, signal, random, words: { min, max } });
        last = script.url;
        if (avoid.includes(script.url)) continue;
        if (fits(await deps.screen(script.text, signal), band)) {
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
