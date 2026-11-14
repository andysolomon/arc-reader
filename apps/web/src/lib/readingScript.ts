/**
 * A short passage for someone to read aloud while recording a voice to clone: a few sentences
 * from a current NPR story, long enough for 10–20 seconds of speech. NPR's text-only site
 * (text.npr.org) is plain HTML with no scripts, so the app's /api/fetch route can read it.
 */

export interface ReadingScript {
  text: string;
  title: string;
  /** The story on npr.org. */
  url: string;
}

const SITE = "https://text.npr.org";
/** NPR's News topic: national and world stories. */
const SECTION = `${SITE}/1001`;
/** Around 150 words a minute, so 35–75 words is roughly 15–30 seconds read aloud. */
export const MIN_WORDS = 35;
export const MAX_WORDS = 75;
const SECTION_TTL_MS = 10 * 60_000;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Story ids (like "nx-s1-6040434") linked from a text.npr.org topic page, in page order. */
export function storyIds(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = [...doc.querySelectorAll<HTMLAnchorElement>("a.topic-title")]
    .map((a) => a.getAttribute("href")?.match(/^\/([\w-]+)$/)?.[1] ?? "")
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Promotions, credits and corrections: a passage stops before any of these. */
const NOT_STORY = /NPR\+|support public media|sign up for|subscribe|newsletter|this (episode|story) was (produced|edited)|^correction|^editor's note|^a previous (version|headline)/i;
/** A transcript's speaker label ("MARTÍNEZ:") or stage direction ("(SOUNDBITE OF MUSIC)"), or a newsletter's emoji bullets. */
const NOT_PROSE = /^(\(|[\p{Lu}'’. -]{2,}:)|\p{Extended_Pictographic}/u;
/** Abbreviations that end with a period without ending the sentence. */
const ABBREVIATION = /(\b(\p{Lu}\.){2,}|\b(Mr|Mrs|Ms|Dr|Sen|Rep|Gov|Gen|Lt|Col|Sgt|St|Jr|Sr|Prof|Rev|No|vs|Inc|Corp|Co|Ft|Mt)\.)$/u;

function sentences(paragraph: string): string[] {
  const parts = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(paragraph)].map((s) => clean(s.segment))
    : paragraph.match(/[^.!?]+[.!?]+["”’)]?/g)?.map(clean) ?? [paragraph];
  const out: string[] = [];
  for (const part of parts.filter(Boolean)) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${part}`;
    else out.push(part);
  }
  return out;
}

/**
 * A story's prose as runs of consecutive paragraphs, each a list of sentences. Lists, italic
 * credits, transcript lines and plugs end a run, so a passage never jumps over them, and every
 * paragraph ends on a full sentence.
 */
export function storyParagraphs(doc: Document): string[][][] {
  const runs: string[][][] = [[]];
  const breakRun = () => { if (runs[runs.length - 1].length) runs.push([]); };
  for (const p of doc.querySelectorAll(".paragraphs-container > p")) {
    if (p.querySelector("ul, ol, li, img, figure")) { breakRun(); continue; }
    p.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
    // Sentences in separate elements can touch: "world.But now".
    const text = clean(p.textContent ?? "").replace(/(\p{Ll}[.!?]["”’)]?)(?=\p{Lu})/gu, "$1 ");
    const italic = clean([...p.querySelectorAll("em, i")].map((e) => e.textContent ?? "").join(" "));
    if (words(text) < 6 || italic.length >= text.length * 0.6 || NOT_PROSE.test(text)) { breakRun(); continue; }
    const all = sentences(text);
    const cut = all.findIndex((sentence) => NOT_STORY.test(sentence));
    const kept = (cut < 0 ? all : all.slice(0, cut)).filter((sentence) => /[.!?]["”’)]?$/.test(sentence));
    // A dropped sentence leaves a gap, so the run ends after what came before it.
    if (kept.length) runs[runs.length - 1].push(kept);
    if (cut >= 0 || kept.length < all.length) breakRun();
  }
  return runs.filter((run) => run.length);
}

/**
 * Every passage that starts at a paragraph and runs whole sentences, into the next paragraph of
 * its run if need be, until it reaches MIN_WORDS; ones longer than MAX_WORDS are dropped.
 */
export function passages(runs: string[][][]): string[] {
  const out: string[] = [];
  for (const run of runs) {
    for (let start = 0; start < run.length; start++) {
      const taken: string[] = [];
      let count = 0;
      for (const sentence of run.slice(start).flat()) {
        taken.push(sentence); count += words(sentence);
        if (count >= MIN_WORDS) break;
      }
      if (count >= MIN_WORDS && count <= MAX_WORDS) out.push(taken.join(" "));
    }
  }
  return [...new Set(out)];
}

/** A random passage from a text.npr.org story page, or null if it has none that fits. */
export function scriptFromStory(html: string, id: string, random = Math.random): ReadingScript | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const options = passages(storyParagraphs(doc));
  if (!options.length) return null;
  const title = clean(doc.querySelector(".story-title")?.textContent ?? doc.title);
  return { text: options[Math.floor(random() * options.length)], title, url: `https://www.npr.org/${id}` };
}

async function page(url: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { signal });
  if (!r.ok) throw new Error(`NPR returned ${r.status}`);
  return r.text();
}

let section: { ids: string[]; at: number } | null = null;

/** Drop the cached story list (for tests). */
export function resetReadingScripts() { section = null; }

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A passage from a random current NPR news story. `avoid` is the story shown last, so asking
 * for another gives a different one. The topic page's story list is reused for ten minutes.
 */
export async function nprReadingScript({ avoid, signal, random = Math.random }: { avoid?: string; signal?: AbortSignal; random?: () => number } = {}): Promise<ReadingScript> {
  if (!section || Date.now() - section.at > SECTION_TTL_MS) {
    const ids = storyIds(await page(SECTION, signal));
    if (!ids.length) throw new Error("NPR listed no stories");
    section = { ids, at: Date.now() };
  }
  const candidates = shuffled(section.ids.filter((id) => avoid !== `https://www.npr.org/${id}`), random);
  // Some stories are podcast notes or photo essays with no run of prose; try a few.
  for (const id of candidates.slice(0, 4)) {
    const script = scriptFromStory(await page(`${SITE}/${id}`, signal), id, random);
    if (script) return script;
  }
  throw new Error("No NPR story had a passage to read");
}
