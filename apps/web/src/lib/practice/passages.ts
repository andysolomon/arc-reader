import { PRACTICE_PASSAGES } from "../../data/practicePassages";
import { nprReadingScript } from "../readingScript";
import { bandInfo, type Band } from "./bands";
import { fits, screenPassage, UNSUITABLE_MAX } from "./screen";
import { rewritePassage } from "./rewrite";
import { wordCount } from "./words";

export interface Passage {
  id: string;
  band: Band;
  text: string;
  title: string;
  url: string;
  source: "npr" | "public-domain";
  author?: string;
  /** An NPR passage rewritten for the band, so it is credited as adapted. */
  adapted?: boolean;
}

/** Bands an NPR passage can serve. Grades 6–8 may get one rewritten down from 9–12. */
const NPR_BANDS: Band[] = ["6-8", "9-12", "college"];
/** How many NPR stories may be turned down before a bundled passage is used instead. */
const NPR_TRIES = 2;
/** A Grades 6–8 rewrite may start from a passage up to this long. */
const REWRITE_FROM_MAX = 110;

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
  rewrite: typeof rewritePassage;
}
const DEPS: PassageDeps = { npr: nprReadingScript, screen: screenPassage, rewrite: rewritePassage };

/**
 * A passage for `band`. For the bands NPR suits, about half the time a current NPR passage is
 * tried. It is kept as written when Jev agrees it fits the band and is suitable; for Grades 6–8 a
 * suitable 9–12 passage is rewritten by the summaries model and kept if the rewrite reads at
 * grade 8 or below and Jev rates it 6–8. Anything that goes wrong falls back to a bundled
 * public-domain passage.
 */
export async function nextPassage(band: Band, { avoid = [], signal, random = Math.random, deps = DEPS }: { avoid?: string[]; signal?: AbortSignal; random?: () => number; deps?: PassageDeps } = {}): Promise<Passage> {
  if (NPR_BANDS.includes(band) && random() < 0.5) {
    const { min, max } = bandInfo(band);
    const range = band === "6-8" ? { min, max: REWRITE_FROM_MAX } : { min, max };
    let last: string | undefined = avoid.at(-1);
    for (let i = 0; i < NPR_TRIES; i++) {
      try {
        const script = await deps.npr({ avoid: last, signal, random, words: range });
        last = script.url;
        if (avoid.includes(script.url)) continue;
        const npr = { id: script.url, band, title: script.title, url: script.url, source: "npr" as const };
        const screening = await deps.screen(script.text, signal);
        if (fits(screening, band) && wordCount(script.text) <= max) return { ...npr, text: script.text };
        if (band === "6-8" && (screening.level === "6-8" || screening.level === "9-12") && screening.unsuitable <= UNSUITABLE_MAX) {
          const rewritten = await deps.rewrite(script.text, band, signal);
          if (rewritten && fits(await deps.screen(rewritten, signal), band)) return { ...npr, text: rewritten, adapted: true };
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        break;
      }
    }
  }
  return bundledPassage(band, avoid, random);
}
