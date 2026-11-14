/**
 * Flesch–Kincaid grade level, a free first check on a passage's difficulty before Jev is asked.
 * Syllables are estimated from vowel groups, which is close enough for English prose.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // A silent final "e" or "es", and "ed" not after t or d ("jumped", but "created").
  const trimmed = w.replace(/([^laeiouy])es?$/, "$1").replace(/([^laeiouytd])ed$/, "$1").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups);
}

export function readingGrade(text: string): number {
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (!words.length) return 0;
  const sentences = Math.max(1, text.split(/[.!?]+(?:["”’)]+)?(?:\s|$)/).filter((s) => /[A-Za-z]/.test(s)).length);
  const syll = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syll / words.length) - 15.59;
}
