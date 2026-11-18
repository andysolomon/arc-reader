/**
 * A book's place in a series, read from its title: "AI Engineering from Scratch: Volume 4 —
 * Large Language Models" is volume 4 of "AI Engineering from Scratch". An EPUB whose record
 * names only the series gets its volume from the title page (see bookFile.ts), so the volumes
 * of one series arrive with titles that differ only after the series' name.
 */
export interface SeriesPlace {
  /** The series' name, as the title gives it */
  name: string;
  /** The same for every volume of the series, however its name is cased or spaced */
  key: string;
  volume: number;
  /** The title without the series' name: "Volume 4 — Large Language Models" */
  rest: string;
}

// The word is matched as written or capitalised; a Roman numeral only in capitals, so "Part in" is not one.
const PLACE = /^(.+?)\s*[:,;–—(-]?\s*\b((?:[Vv]olume|VOLUME|[Vv]ol\.?|VOL\.?|[Bb]ook|BOOK|[Pp]art|PART)\s+(\d{1,3}|[IVXLC]{1,7})\b.*)$/;
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function roman(numeral: string): number {
  let total = 0;
  for (let i = 0; i < numeral.length; i++) {
    const value = ROMAN[numeral[i]], next = ROMAN[numeral[i + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

export function seriesPlace(title: string): SeriesPlace | null {
  const match = PLACE.exec(title.trim());
  if (!match) return null;
  const name = match[1].trim();
  const volume = /^\d/.test(match[3]) ? Number(match[3]) : roman(match[3]);
  // A title that opens with the word ("Part 2 of the report") names no series.
  if (!/[\p{L}\p{N}]/u.test(name) || volume < 1) return null;
  const rest = match[2].trim();
  // "(Part II)" ends with the bracket that opened before it.
  return { name, key: name.toLowerCase().replace(/\s+/g, " "), volume, rest: rest.includes("(") ? rest : rest.replace(/\)$/, "") };
}
