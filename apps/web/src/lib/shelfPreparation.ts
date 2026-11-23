import type { PreparedVoice } from "./prepared";

/** What a shelf needs to know about one of its chapters. */
export interface ShelfChapter {
  id: string;
  /** How long it reads, in seconds: longer chapters count for more of the whole */
  duration: number;
  prepared: PreparedVoice[];
}

/** A reading being made right now, as the preparation queue counts it. */
export interface ShelfJob {
  docId: string;
  voice: { id: string; name: string; engine: string };
  done: number;
  total: number;
  status?: string;
}

/** One voice's audio across a book or series. */
export interface ShelfVoice {
  voice: PreparedVoice;
  /** 0..1 of the whole, each chapter weighted by its length; audio being made counts as it is made */
  fraction: number;
  /** Chapters fully prepared */
  complete: number;
  /** Chapters queued, being made or being saved */
  busy: number;
  /** Of those, the ones whose audio is already made and only being copied onto this device */
  saving: number;
  chapters: number;
}

const voiceKey = (voice: { voiceId: string; engine: string }) => `${voice.engine}\u0000${voice.voiceId}`;

/**
 * How much of a book each voice has prepared: chapters are weighted by how long they read, so a
 * short preface finished first doesn't make a long book look a tenth done. A chapter being made
 * counts by the passages generated so far when that is further than what is saved.
 */
export function shelfPreparation(chapters: ShelfChapter[], jobs: ShelfJob[]): ShelfVoice[] {
  if (!chapters.length) return [];
  // An unknown length counts as an average chapter's, so it still moves the whole.
  const known = chapters.filter((c) => c.duration > 0);
  const average = known.length ? known.reduce((sum, c) => sum + c.duration, 0) / known.length : 1;
  const weight = (c: ShelfChapter) => (c.duration > 0 ? c.duration : average);
  const whole = chapters.reduce((sum, c) => sum + weight(c), 0);
  const voices = new Map<string, { voice: PreparedVoice; done: Map<string, number>; complete: Set<string>; busy: Set<string>; saving: Set<string> }>();
  const entry = (voice: PreparedVoice) => {
    const key = voiceKey(voice);
    if (!voices.has(key)) voices.set(key, { voice: { ...voice, fraction: 0 }, done: new Map(), complete: new Set(), busy: new Set(), saving: new Set() });
    return voices.get(key)!;
  };
  const ids = new Set(chapters.map((c) => c.id));
  for (const chapter of chapters) {
    for (const voice of chapter.prepared) {
      if (voice.fraction <= 0) continue;
      const tally = entry(voice);
      tally.done.set(chapter.id, Math.min(1, voice.fraction));
      if (voice.fraction >= 1) tally.complete.add(chapter.id);
    }
  }
  for (const job of jobs) {
    if (!ids.has(job.docId)) continue;
    const tally = entry({ voiceId: job.voice.id, name: job.voice.name, engine: job.voice.engine, fraction: 0 });
    tally.busy.add(job.docId);
    // Audio the server has finished counts as prepared already; what is left is downloading it.
    if (job.status === "saving" || tally.complete.has(job.docId)) tally.saving.add(job.docId);
    // A run starts its count at zero even when most of the audio is already saved.
    const generated = job.total > 0 ? Math.max(0, Math.min(1, job.done / job.total)) : 0;
    tally.done.set(job.docId, Math.max(tally.done.get(job.docId) ?? 0, generated));
  }
  return [...voices.values()].map(({ voice, done, complete, busy, saving }) => {
    let made = 0;
    for (const chapter of chapters) made += weight(chapter) * (done.get(chapter.id) ?? 0);
    return { voice, fraction: whole ? Math.min(1, made / whole) : 0, complete: complete.size, busy: busy.size, saving: saving.size, chapters: chapters.length };
  });
}

/** A whole number of percent that only says 100 when every chapter is done, and 0 only when nothing is. */
export function shelfPercent({ fraction, complete, chapters }: Pick<ShelfVoice, "fraction" | "complete" | "chapters">): number {
  if (complete >= chapters) return 100;
  const percent = Math.floor(fraction * 100);
  return fraction > 0 ? Math.max(1, Math.min(99, percent)) : 0;
}
