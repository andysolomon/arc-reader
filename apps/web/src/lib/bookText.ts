/**
 * A whole book that arrives as one plain text, a scan's OCR or a transcription, made ready to
 * read aloud: page headers and numbers removed, paragraphs put back together across line and
 * page breaks, and the text cut into its chapters. OCR misreads headings as readily as prose,
 * so nothing here trusts a chapter number on its own.
 */
export interface BookPart {
  title: string;
  /** Opens with the part's heading as a Markdown heading */
  text: string;
}

/** About 25 minutes of listening: the size of a part when a book's chapters can't be told apart */
const PART_CHARS = 24_000;
/** A heading with less text than this under it is still the contents list, not yet the book */
const MIN_BODY = 1500;
/** A part or volume heading this close above a chapter heading belongs to that chapter */
const CARRY_CHARS = 600;

const CHAPTER_KINDS = ["chapter", "letter", "stave", "canto"];
const DIVISION_KINDS = ["part", "book", "volume"];

const UNITS = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const NTHS = "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth".split(" ");
const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const TENTHS = "twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth".split(" ");
const WORDS = `(?:${[...TENS, ...TENTHS].join("|")})(?:[-\\s](?:${[...UNITS.slice(0, 9), ...NTHS.slice(0, 9)].join("|")}))?|${[...UNITS, ...NTHS].join("|")}`;

const KEYWORD = /^(chapter|chap|letter|stave|canto|part|book|volume)\b[.,]?\s*(?:the\s+)?(.*)$/i;
/** The number after the keyword: digits, words, or Roman numerals as OCR tends to leave them ("Ii", "VIL", "1V") */
const NUMBER = new RegExp(`^(\\d{1,3}|${WORDS}|[IVXLC1|!T]{1,8})(?=$|[\\s.,:;—–-])`, "i");
const END = /^(?:the end|finis|end of (?:the )?(?:\S+ )?(?:vol(?:ume)?|book|part)\b.{0,20})[.,!]*$/i;
const SMALL = /^(?:a|an|and|as|at|but|by|for|from|in|of|on|or|the|to|with)$/;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const letters = (text: string) => text.replace(/[^\p{L}]/gu, "");
const upperShare = (text: string) => { const all = letters(text); return all ? all.replace(/[^\p{Lu}]/gu, "").length / all.length : 0; };
/** Set in capitals, as headings and page headers are */
const shouting = (text: string, min = 4) => letters(text).length >= min && upperShare(text) >= 0.6;
const endsSentence = (text: string) => /[.!?]["'”’)\]]*$/.test(text);
/** A paragraph of running text, as opposed to a title page, a list or a caption */
const isProse = (text: string) => text.length >= 150 && endsSentence(text) && (text.match(/\p{Ll}/gu)?.length ?? 0) / text.replace(/\s/g, "").length > 0.6;

function roman(numeral: string): number | null {
  if (!/^(?=[IVXLC])C{0,3}(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(numeral)) return null;
  const value: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < numeral.length; i++) n += value[numeral[i]] < (value[numeral[i + 1]] ?? 0) ? -value[numeral[i]] : value[numeral[i]];
  return n;
}

function wordNumber(words: string): number | null {
  const [a, b] = words.toLowerCase().split(/[-\s]+/);
  const unit = (word?: string) => (word ? Math.max(UNITS.indexOf(word), NTHS.indexOf(word)) + 1 : 0);
  const tens = Math.max(TENS.indexOf(a), TENTHS.indexOf(a));
  return tens >= 0 ? (tens + 2) * 10 + unit(b) : unit(a) || null;
}

/**
 * The number a heading carries. When the numeral as printed doesn't follow the heading before
 * it but does once the usual misreadings of "I" are undone ("XL" for XI), the latter is meant;
 * a numeral that can't be read at all is taken to follow on.
 */
function numberOf(token: string, expected: number): number | null {
  if (!token) return null;
  if (/^\d+$/.test(token)) return Number(token);
  const word = wordNumber(token);
  if (word) return word;
  const strict = roman(token.toUpperCase());
  const loose = roman(token.toUpperCase().replace(/[L1|!T]/g, "I"));
  return strict === expected ? strict : loose === expected ? loose : strict ?? loose ?? expected;
}

interface Heading {
  kind: string;
  token: string;
  n: number | null;
  title: string;
}

type Item = string | Heading;
const isHead = (item: Item): item is Heading => typeof item !== "string";

/** "MR. SHERLOCK HOLMES." → "Mr. Sherlock Holmes" */
function titled(text: string): string {
  const t = polish(text).replace(/^[\s.,:;—–-]+|[\s.,:;—–-]+$/g, "");
  if (/\p{Ll}/u.test(t)) return t;
  return t.toLowerCase().replace(/[\p{L}'’]+/gu, (word, at: number) => (at > 0 && SMALL.test(word) ? word : word[0].toUpperCase() + word.slice(1)));
}

const label = (h: Pick<Heading, "kind" | "n">) => `${h.kind[0].toUpperCase()}${h.kind.slice(1)}${h.n ? ` ${h.n}` : ""}`;
const headingLine = (h: Heading, depth: string) => `${depth} ${label(h)}${h.title ? `: ${h.title}` : ""}`;

/**
 * A heading that stands alone as a paragraph: "CHAPTER II", "Chapter 3. The Arrival", or the
 * number on one line and the title on the next. `rest` is text that followed without a break.
 */
function headingOf(lines: string[]): { heading: Heading; rest: string[] } | null {
  const m = lines[0].match(KEYWORD);
  if (!m || !/^\p{Lu}/u.test(m[1])) return null;
  const shout = m[1] === m[1].toUpperCase();
  // After "CHAPTER" in capitals, a short word is a numeral the scan could not read: "CHAPTER H." for II.
  const token = m[2].match(NUMBER)?.[1] ?? (shout && /^chap/i.test(m[1]) ? m[2].match(/^(\S{1,4}?)[.,:;]?$/)?.[1] : undefined) ?? "";
  if (!token && !(shout && !m[2])) return null;
  // Capitals mark a heading by themselves; "Part I liked best" needs a numeral that is exact.
  if (token && !shout && !/^\d+$/.test(token) && !wordNumber(token) && roman(token) === null) return null;
  const after = m[2].slice(token.length).replace(/^[\s.,:;—–-]+/, "");
  if (after.length > 80 || /^\p{Ll}/u.test(after)) return null;
  // A contents entry ends with its page number.
  const heading: Heading = { kind: m[1].toLowerCase().replace(/^chap$/, "chapter"), token, n: null, title: titled(after.replace(/[\s.…·]+\d{1,3}$/, "")) };
  if (lines.length === 1) return { heading, rest: [] };
  if (after) return null;
  const below = tidy(lines.slice(1).join(" "));
  // Without a break after the number, the next line may as well be the chapter's first words as its title.
  const titleLike = shouting(below) || !/^[("'“‘]|[,;]$/.test(below);
  if (lines.length > 3 || below.length > 100 || !titleLike) return { heading, rest: lines.slice(1) };
  return { heading: { ...heading, title: titled(below) }, rest: [] };
}

const lineKey = (line: string) => letters(line).toUpperCase();
/** A line that could be a page header: short, and not something anyone says */
const headerLike = (line: string) => line.length <= 70 && !/["“”?!]|[,;:]$/.test(line);

/** Lines repeated at the edges of paragraphs throughout the book: its running headers. */
function repeatedLines(blocks: string[][]): Set<string> {
  const counts = new Map<string, { n: number; shout: boolean }>();
  for (const lines of blocks) {
    for (const line of lines.length === 1 ? lines : [lines[0], lines[lines.length - 1]]) {
      if (!headerLike(line)) continue;
      const key = lineKey(line);
      const seen = counts.get(key) ?? { n: 0, shout: shouting(line) };
      counts.set(key, { ...seen, n: seen.n + 1 });
    }
  }
  return new Set(Array.from(counts).flatMap(([key, { n, shout }]) => (shout ? n >= 6 && key.length >= 4 : n >= 12 && key.length >= 8) ? [key] : []));
}

/**
 * A page number, a header set in capitals beside one, or a line the book keeps repeating. A bare
 * number counts only when it stands `alone`: as a paragraph's last line it is the end of a sentence.
 */
function isPageFurniture(line: string, repeated: Set<string>, alone = true): boolean {
  if (line.length > 70) return false;
  if (alone && /^[^\p{L}]*\d{1,4}[^\p{L}\d]*$/u.test(line)) return true;
  const beside = line.match(/^(?:\d{1,4}|[ivxl]{1,6})\s+(.+)$/) ?? line.match(/^(.+?)\s+(?:\d{1,4}|[ivxl]{1,6})[^\p{L}\d]*$/u);
  if (beside && shouting(beside[1], 6)) return true;
  return headerLike(line) && repeated.has(lineKey(line));
}

/** Tidy spacing and the marks plain-text transcriptions use in place of typography. */
function polish(text: string): string {
  return tidy(text)
    .replace(/_+/g, "")
    .replace(/--+/g, "—")
    .replace(/([\p{L}\d]) ([;:?!,])(?=\s|$)/gu, "$1$2")
    .replace(/([“‘]) /g, "$1")
    .replace(/ ”/g, "”")
    // Nothing in a scan is Markdown, whatever a stray mark at the start of a paragraph looks like.
    .replace(/^[#`~>\s]+/, "");
}

/** Lines of one paragraph as one line, with words broken at a line end made whole. */
const joinLines = (lines: string[]) => polish(lines.reduce((text, line) => (!text ? line : /\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line) ? text.slice(0, -1) + line : `${text} ${line}`), ""));

/** OCR of a picture, an ornament or a stamp: too few letters to be words. */
function isNoise(text: string): boolean {
  const count = letters(text).length;
  return count < 3 || (text.length < 40 && count / text.replace(/\s/g, "").length < 0.5);
}

/** Project Gutenberg's licence wraps the book at both ends. */
function withoutLicence(text: string): string {
  const starts = Array.from(text.matchAll(/^.*(?:\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG|\*END\*THE SMALL PRINT).*$/gm));
  const start = starts[starts.length - 1];
  if (start && start.index < text.length * 0.3) text = text.slice(start.index + start[0].length);
  const end = text.search(/^.*(?:\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG|End of (?:the )?Project Gutenberg).*$/im);
  return end > text.length * 0.5 ? text.slice(0, end) : text;
}

/** The book as headings and paragraphs in order, without page furniture or picture noise. */
function read(raw: string): Item[] {
  const blocks = withoutLicence(raw.replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n")).split(/\n[ \t]*\n/)
    .map((block) => block.split("\n").map(tidy).filter(Boolean)).filter((lines) => lines.length);
  // Google's scans open with a page of terms that reads like prose.
  blocks.splice(0, blocks.slice(0, 40).findIndex((lines) => lines.some((line) => line.includes("books.google.com"))) + 1);
  const repeated = repeatedLines(blocks);
  const items: Item[] = [];
  const expected = new Map<string, number>();
  const addText = (lines: string[]) => {
    // A header or page number can sit against the text with no blank line between.
    while (lines.length && isPageFurniture(lines[0], repeated, lines.length === 1)) lines = lines.slice(1);
    while (lines.length && isPageFurniture(lines[lines.length - 1], repeated, lines.length === 1)) lines = lines.slice(0, -1);
    const text = joinLines(lines);
    if (text && !isNoise(text)) items.push(text);
  };
  for (let i = 0; i < blocks.length; i++) {
    const found = headingOf(blocks[i]);
    if (!found) { addText(blocks[i]); continue; }
    const { heading, rest } = found;
    heading.n = numberOf(heading.token, (expected.get(heading.kind) ?? 0) + 1);
    if (heading.n) expected.set(heading.kind, heading.n);
    // The chapter's title is often set on its own beneath the number, in capitals.
    const next = blocks[i + 1];
    if (!heading.title && !rest.length && next?.length === 1 && next[0].length <= 60 && shouting(next[0]) && !headingOf(next) && !isPageFurniture(next[0], repeated)) {
      heading.title = titled(next[0]);
      i++;
    }
    items.push(heading);
    if (rest.length) addText(rest);
  }
  return items;
}

/** Paragraphs a page break cut in two, joined again. */
function paragraphs(blocks: string[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (last && !last.startsWith("#") && /^\p{Ll}/u.test(block) && !/[.!?:;]["'”’)\]]*$/.test(last)) {
      out[out.length - 1] = /\p{L}-$/u.test(last) ? last.slice(0, -1) + block : `${last} ${block}`;
    } else out.push(block);
  }
  return out;
}

const size = (blocks: string[]) => blocks.reduce((n, block) => n + block.length, 0);

/** Drop what comes before the first paragraph of running text: title page, contents, lists of plates. */
function fromFirstProse(blocks: string[]): string[] {
  const at = blocks.findIndex(isProse);
  return at < 0 ? [] : blocks.slice(at);
}

/** A line of a list: one short line, and not a sentence */
const isEntry = (block: string | undefined) => !!block && block.length < 80 && !endsSentence(block);

/**
 * Drop a list that opens a chapter: the first heading found can be a contents entry with the
 * rest of the contents beneath it. A few short lines are left alone, since a chapter may open
 * with an epigraph, and the list ends where two blocks in a row read as sentences.
 */
function afterList(blocks: string[]): string[] {
  let cut = 0;
  for (let i = 0, entries = 0; i < blocks.length && !isProse(blocks[i]); i++) {
    if (isEntry(blocks[i])) { if (++entries >= 5) cut = i + 1; }
    else if (!isEntry(blocks[i + 1])) break;
  }
  return blocks.slice(cut);
}

/** Drop what follows the book's last words, looking no earlier than `from`: "THE END", advertisements, the printer's imprint, library stamps. */
function toLastProse(blocks: string[], from = 0): string[] {
  const marker = blocks.findIndex((block, at) => at >= from && END.test(block));
  if (marker >= 0) return blocks.slice(0, marker);
  let end = blocks.length;
  const trailing = (block: string) => block.startsWith("#") || (block.length < 200 && shouting(block)) || (block.length < 100 && !endsSentence(block));
  while (end > 0 && trailing(blocks[end - 1])) end--;
  return blocks.slice(0, end);
}

interface Section {
  head?: Heading;
  /** A part or volume heading that opens with this chapter, read out before the chapter's own */
  lead: string[];
  blocks: string[];
}

/** The book cut at headings of the given kinds, or null when they don't divide it. */
function sections(items: Item[], kinds: string[]): Section[] | null {
  const heads = items.flatMap((item, at) => (isHead(item) && kinds.includes(item.kind) ? [at] : []));
  const head = (i: number) => items[heads[i]] as Heading;
  const bodies = heads.map((at, i) => size(items.slice(at + 1, heads[i + 1] ?? items.length).filter((item): item is string => !isHead(item))));
  // The last entry of a contents list has the preface or an unmarked first chapter under it; the numbering starts again after it.
  const endsContents = (i: number) => i >= 2 && bodies[i - 1] < MIN_BODY && bodies[i - 2] < MIN_BODY && i + 1 < heads.length
    && !!head(i).n && !!head(i + 1).n && head(i + 1).n! <= head(i).n!;
  const start = bodies.findIndex((body, i) => body >= MIN_BODY && !endsContents(i));
  if (start < 0 || heads.length - start < 3) return null;

  // The part the first chapter opens is announced just above it.
  let from = heads[start];
  for (let i = from - 1, chars = 0; i >= 0 && chars <= CARRY_CHARS; i--) {
    const item = items[i];
    if (!isHead(item)) { chars += item.length; continue; }
    if (!kinds.includes(item.kind)) from = i;
    break;
  }
  const out: Section[] = [];
  const opening = fromFirstProse(paragraphs(items.slice(0, from).filter((item): item is string => !isHead(item))));
  let current: Section = { lead: [], blocks: opening };
  // A part heading and what follows it, until it is clear which chapter they open.
  let carry: string[] | null = null;
  for (const item of items.slice(from)) {
    if (!isHead(item)) {
      if (!carry) { current.blocks.push(item); continue; }
      carry.push(item);
      if (size(carry) > CARRY_CHARS) { current.blocks.push(...carry); carry = null; }
    } else if (kinds.includes(item.kind)) {
      // The same heading again is the page header repeating it.
      if (!carry && current.head && current.head.kind === item.kind && !!item.n && current.head.n === item.n) continue;
      out.push(current);
      current = { head: item, lead: carry ?? [], blocks: [] };
      carry = null;
    } else {
      if (carry) current.blocks.push(...carry);
      carry = [headingLine(item, "##")];
    }
  }
  if (carry) current.blocks.push(...carry);
  out.push(current);
  out[1].blocks = afterList(out[1].blocks);
  // What precedes the first heading found is the first chapter when its own heading was misread, or a preface.
  if (size(opening) < MIN_BODY) out.shift();
  else if (head(start).n === 2) out[0].head = { kind: head(start).kind, token: "", n: 1, title: "" };
  return out;
}

/** Equal parts cut between paragraphs, for a book with no chapter headings to go by. */
function bySize(blocks: string[]): string[][] {
  const out: string[][] = [[]];
  for (const block of blocks) {
    if (size(out[out.length - 1]) >= PART_CHARS) out.push([]);
    out[out.length - 1].push(block);
  }
  if (out.length > 1 && size(out[out.length - 1]) < PART_CHARS / 3) out[out.length - 2].push(...out.pop()!);
  return out;
}

/**
 * The parts of a book in reading order: its chapters where their headings can be found, parts
 * of even length otherwise. One part with no title means the text is short enough to stand alone.
 */
export function splitBook(raw: string, maxParts = 500): BookPart[] {
  const items = read(raw);
  const found = sections(items, CHAPTER_KINDS) ?? sections(items, DIVISION_KINDS);
  if (found && found.length <= maxParts) {
    found[found.length - 1].blocks = toLastProse(found[found.length - 1].blocks);
    return found.flatMap(({ head, lead, blocks }) => {
      const body = paragraphs(blocks);
      if (!body.length) return [];
      return [{ title: head ? head.title || label(head) : "Opening", text: [...lead, ...(head ? [headingLine(head, "#")] : []), ...body].join("\n\n") }];
    });
  }
  const whole = fromFirstProse(items.map((item) => (isHead(item) ? headingLine(item, "##") : item)));
  const all = paragraphs(toLastProse(whole, Math.floor(whole.length * 0.8)));
  const parts = bySize(all);
  if (parts.length === 1) return all.length ? [{ title: "", text: all.join("\n\n") }] : [];
  return parts.map((blocks, i) => ({ title: `Part ${i + 1}`, text: [`# Part ${i + 1}`, ...blocks].join("\n\n") }));
}
