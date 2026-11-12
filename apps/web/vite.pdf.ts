/**
 * PDFs have no markup to read, only runs of text placed on a page. This reads those runs back
 * into lines and turns the file into a small HTML page the reader's normal extraction
 * understands, the way X posts are handled. A slide deck becomes one titled section per slide,
 * with a picture of the slide wherever it shows more than text; any other PDF becomes headings
 * and flowing paragraphs. A PDF that is only scanned pages has no text and is refused.
 */

export const MAX_PDF_BYTES = 60 * 1024 * 1024;
const MAX_PAGES = 2000;
/** Fewer characters than this and the file has no text layer worth reading. */
const MIN_TEXT = 40;
/** Slide pictures are this many pixels wide: enough to read a slide's small print. */
const PICTURE_WIDTH = 1280;

/** One run of text as the PDF places it: where its baseline starts (y grows upwards) and its size. */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a page draws besides its text. */
export interface PdfDrawing {
  /** Each picture placed on the page: the share of the page it covers, its place and size, and which picture the file says it is */
  images: { area: number; at: string; id: string }[];
  /** Shapes and lines drawn */
  paths: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfItem[];
  drawing?: PdfDrawing;
}

export interface PdfInfo {
  title?: string;
  author?: string;
  /** As the file writes it: "D:20260923221412+00'00'" */
  created?: string;
}

interface Line {
  text: string;
  x: number;
  /** Where the words start, past any bullet */
  textX: number;
  y: number;
  size: number;
  bulleted: boolean;
}

/** A bullet point or paragraph: one line, or several that wrap. */
interface Entry {
  text: string;
  x: number;
  textX: number;
  /** Where its latest line starts */
  lineX: number;
  /** Baseline of its first and last lines */
  top: number;
  bottom: number;
  size: number;
  bulleted: boolean;
}

/** Served as a PDF, going by its content type alone. */
export const isPdfType = (contentType: string) => /application\/(?:x-)?pdf/i.test(contentType);

/** A PDF by its type or by its opening bytes, since many servers send one as a plain download. */
export const isPdf = (bytes: Uint8Array, contentType = "") => isPdfType(contentType) || Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-");

const BULLET = /^[●○•◦▪■□▸▶►➢➤❖◆◇·∙‣⁃*–—-]$/;
const LEADING_BULLET = /^(?:[●○•◦▪■□▸▶►➢➤❖◆◇∙‣⁃]\s*|[-–*]\s+(?=\S))/;
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const endsSentence = (text: string) => /[.!?…:;]["'”’)]?$/.test(text);
const sentence = (text: string) => endsSentence(text) ? text : `${text}.`;
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page's text as lines, in the order the file draws them: columns and text boxes stay whole. */
export function pageLines(page: PdfPage): Line[] {
  const lines: Line[] = [];
  let parts: PdfItem[] = [];
  const close = () => {
    const words = parts.filter((p) => p.str.trim());
    parts = [];
    if (!words.length) return;
    const marked = words.length > 1 && BULLET.test(words[0].str.trim());
    const said = marked ? words.slice(1) : words;
    // The size most of the line is set in. A bullet is often larger, and the run of words drawn
    // with it is reported at the bullet's size, so that run has no say when there are others.
    const led = !marked && said.length > 1 && LEADING_BULLET.test(said[0].str.trimStart());
    const weight = new Map<number, number>();
    for (const part of led ? said.slice(1) : said) weight.set(part.height, (weight.get(part.height) ?? 0) + part.str.trim().length);
    const size = [...weight.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
    let text = "", right = said[0].x;
    for (const part of said) {
      // Runs are split wherever the font changes; only a real gap is a space.
      if (text && !/\s$/.test(text) && !/^\s/.test(part.str) && part.x - right > size * 0.15) text += " ";
      text += part.str;
      right = part.x + part.width;
    }
    const inline = !marked && LEADING_BULLET.test(tidy(text));
    text = tidy(inline ? tidy(text).replace(LEADING_BULLET, "") : text);
    if (!text || BULLET.test(text)) return;
    const first = words[0];
    lines.push({ text, x: first.x, textX: marked ? said[0].x : inline ? first.x + size : first.x, y: said[0].y, size, bulleted: marked || inline });
  };
  let last: PdfItem | null = null;
  for (const item of page.items) {
    // Spaces are kept (they are often their own run) without letting them decide where a line is.
    if (!item.str.trim()) { if (item.str && parts.length) parts.push({ ...item, x: last ? last.x + last.width : item.x, y: last?.y ?? item.y, height: 0 }); continue; }
    if (last) {
      const size = Math.max(last.height, item.height) || 1;
      const moved = Math.abs(item.y - last.y) > size * 0.45;
      const gap = item.x - (last.x + last.width);
      // A wide gap on one baseline is the next column or table cell; text that jumps back left is a new box.
      if (moved || gap > size * 2.5 || gap < -size * 2) close();
    }
    parts.push(item);
    last = item;
  }
  close();
  return lines;
}

/** Lines joined where a bullet or paragraph wraps onto the next line. */
function entries(lines: Line[], joinHyphens: boolean): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const size = Math.max(line.size, prev?.size ?? 0);
    const below = prev ? prev.bottom - line.y : 0;
    const sameSize = !!prev && Math.abs(prev.size - line.size) <= size * 0.12;
    const aligned = !!prev && (Math.min(Math.abs(line.x - prev.textX), Math.abs(line.x - prev.lineX)) <= size * 0.6
      // Where the bullet is part of the run of text, its words start somewhere just right of it.
      || (prev.bulleted && line.x > prev.x && line.x <= prev.x + size * 3));
    // A bullet's first line can be reported at the bullet's own, larger size.
    const inflated = !!prev && prev.bulleted && prev.top === prev.bottom && aligned && line.size < prev.size && line.size >= prev.size * 0.75;
    const wraps = !!prev && !line.bulleted && (sameSize || inflated) && below > 0 && below <= size * 1.55
      // A wrapped bullet lines up with its words; centred text wraps anywhere, mid-sentence.
      && (aligned || (!prev.bulleted && !endsSentence(prev.text)));
    if (!wraps) { out.push({ text: line.text, x: line.x, textX: line.textX, lineX: line.textX, top: line.y, bottom: line.y, size: line.size, bulleted: line.bulleted }); continue; }
    const broken = joinHyphens && /[a-z]-$/.test(prev.text) && /^[a-z]/.test(line.text);
    prev.text = broken ? prev.text.slice(0, -1) + line.text : `${prev.text} ${line.text}`;
    prev.bottom = line.y;
    prev.lineX = line.x;
    if (inflated) prev.size = line.size;
  }
  return out;
}

const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:\/|of)\s*\d{1,4})?$/i;
const marginKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#");

/** Page numbers, and the running headers and footers most pages repeat in their margins. */
function withoutFurniture(pages: { height: number; lines: Line[] }[], top: number, bottom: number): Line[][] {
  const inMargin = (page: { height: number }, line: Line) => line.y > page.height * (1 - top) || line.y < page.height * bottom;
  const seen = new Map<string, number>();
  for (const page of pages) {
    for (const key of new Set(page.lines.filter((line) => inMargin(page, line)).map((line) => marginKey(line.text)))) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const repeated = (line: Line) => pages.length >= 4 && (seen.get(marginKey(line.text)) ?? 0) >= pages.length * 0.5;
  return pages.map((page) => page.lines.filter((line) => !inMargin(page, line) || !(PAGE_NUMBER.test(line.text) || repeated(line))));
}

/** A picture covering less of the slide than this is an icon or a logo. */
const MIN_PICTURE_AREA = 0.03;
/** This many shapes beyond what the deck's plainest slides draw make a diagram, not a rule or a text box. */
const MIN_DIAGRAM_PATHS = 40;

/**
 * Which pages show something worth looking at besides their text: a photo, screenshot or chart
 * placed on the slide, or a diagram drawn on it. The logo and background every slide repeats
 * do not count.
 */
export function pictured(pages: PdfPage[]): boolean[] {
  const placed = new Map<string, { pages: number; ids: Set<string> }>();
  for (const page of pages) {
    for (const at of new Set(page.drawing?.images.map((image) => image.at))) {
      const seen = placed.get(at) ?? { pages: 0, ids: new Set<string>() };
      seen.pages++;
      for (const image of page.drawing!.images) if (image.at === at) seen.ids.add(image.id);
      placed.set(at, seen);
    }
  }
  // The same picture in the same place on half the slides belongs to the template; a photo deck
  // puts a different picture there each time, and a short deck may be one slide built up in steps.
  const furniture = (at: string) => {
    const seen = placed.get(at);
    return !!seen && pages.length >= 8 && seen.pages >= pages.length * 0.5 && seen.ids.size <= 3;
  };
  const counts = pages.map((page) => page.drawing?.paths ?? 0).sort((a, b) => a - b);
  const usual = counts[Math.floor(counts.length / 4)] ?? 0;
  return pages.map((page) => {
    if (!page.drawing) return false;
    const area = page.drawing.images.filter((image) => !furniture(image.at)).reduce((sum, image) => sum + image.area, 0);
    return area >= MIN_PICTURE_AREA || page.drawing.paths >= usual + MIN_DIAGRAM_PATHS;
  });
}

export interface Slide {
  /** 1-based page of the file */
  page: number;
  title: string;
  points: string[];
  /** It shows a picture or diagram, not only text */
  pictured: boolean;
}

/** Where a slide's picture came from: words for the eye, usually ending in a web address. */
const CREDIT = /(?:^|\s)(?:image|photo|figure|picture|diagram|graphic|icon|table|chart|plot|screenshot)s?\s+(?:credits?|sources?|inspiration|courtesy)\b.*$|^(?:credits?|sources?|adapted from|courtesy of)\s*:.*$|^https?:\/\/\S+$/i;

/** A slide's lines without the credits for its pictures, which may share a line with the footer or wrap onto the next. */
function withoutCredits(lines: Line[]): Line[] {
  const out: Line[] = [];
  let credit: Line | null = null;
  for (const line of lines) {
    // The rest of an address that wrapped: one unbroken word just under the credit.
    if (credit && !/\s/.test(line.text) && Math.abs(line.size - credit.size) <= credit.size * 0.12 && credit.y > line.y && credit.y - line.y <= credit.size * 1.55) { credit = line; continue; }
    const text = tidy(line.text.replace(CREDIT, ""));
    credit = text === line.text ? null : line;
    if (text) out.push({ ...line, text });
  }
  return out;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const MAX_LABELS = 12;

/**
 * What a slide says besides its title. A diagram's labels are scattered words, not points: the
 * ones that mean something alone are read once, as a single list, after the slide's sentences.
 */
function slidePoints(list: Entry[]): string[] {
  // Stray symbols and bare numbers come from charts and formulas, which are drawn, not written.
  const said = list.filter((e) => /\p{L}{2}/u.test(e.text));
  const isLabel = (e: Entry) => !e.bulleted && wordCount(e.text) <= 2 && !/[.!?]$/.test(e.text);
  const labels = said.filter(isLabel);
  if (labels.length < 6 || labels.length < said.length * 0.5) return said.map((e) => e.text);
  const names = [...new Set(labels.map((e) => e.text).filter((text) => /\p{L}{3}/u.test(text)))].slice(0, MAX_LABELS);
  return [...said.filter((e) => !isLabel(e)).map((e) => e.text), ...(names.length > 1 ? [names.join(", ")] : names)];
}

/** One slide per page: text set clearly bigger than the rest is its title, the rest its points. */
export function slides(pages: PdfPage[]): Slide[] {
  const kept = withoutFurniture(pages.map((page) => ({ height: page.height, lines: withoutCredits(pageLines(page)) })), 0, 0.12);
  const shown = pictured(pages);
  const all = kept.map((lines, i): Slide => {
    const list = entries(lines, false);
    const size = Math.max(0, ...list.map((e) => e.size));
    const biggest = list.filter((e) => e.size >= size * 0.95 && e.text.length <= 200 && /\p{L}{3}|\d/u.test(e.text));
    // Titles sit at the top; a slide that is one statement sets it mid-page.
    const candidate = biggest.find((e) => e.top > pages[i].height * 0.6) ?? biggest[0];
    const others = list.filter((e) => e !== candidate).map((e) => e.size).sort((x, y) => x - y);
    const usual = others[Math.floor(others.length / 2)] ?? 0;
    const heading = candidate && (list.length <= 3 || candidate.size >= usual * 1.2) ? candidate : undefined;
    return { page: i + 1, title: heading?.text ?? "", points: slidePoints(list.filter((e) => e !== heading)), pictured: shown[i] };
  });
  // A slide built up one click at a time is exported once per click; keep the finished one.
  return all.filter((slide, i) => {
    // A slide with no words can still be a picture worth describing.
    if (!slide.title && !slide.points.length) return slide.pictured;
    const next = all[i + 1];
    return !(next && next.title === slide.title && slide.points.every((point) => next.points.includes(point)) && keepsPictures(pages[i], pages[i + 1]));
  });
}

/** Every picture on the page is still in its place on the next one, as when a slide gains a step. */
function keepsPictures(page: PdfPage, next: PdfPage): boolean {
  const there = new Set(next.drawing?.images.map((image) => image.at));
  return (page.drawing?.images ?? []).every((image) => image.area < MIN_PICTURE_AREA || there.has(image.at));
}

interface Block {
  text: string;
  heading?: 1 | 2;
}

/** A document's text as headings and paragraphs, read down each column and across page breaks. */
export function paragraphs(pages: PdfPage[]): Block[] {
  const kept = withoutFurniture(pages.map((page) => ({ height: page.height, lines: pageLines(page) })), 0.08, 0.08);
  const weight = new Map<number, number>();
  for (const line of kept.flat()) {
    const size = Math.round(line.size * 2) / 2;
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const titleSize = Math.max(0, ...(kept[0] ?? []).map((line) => line.size));
  const blocks: Block[] = [];
  /** The latest paragraph of running text; footnotes and captions may sit between it and its next line. */
  let open: Block | null = null;
  for (const lines of kept) {
    for (const entry of entries(lines, true)) {
      const big = entry.size >= body * 1.15 && entry.text.length <= 200;
      const heading = !big ? undefined : !blocks.some((b) => b.heading === 1) && entry.size >= titleSize * 0.95 ? 1 : 2;
      const running = !heading && Math.abs(entry.size - body) <= body * 0.06;
      // A paragraph carries over a column or page break when it stops mid-sentence.
      if (open && running && !entry.bulleted && !endsSentence(open.text) && /^[a-z(]/.test(entry.text)) {
        open.text = /[a-z]-$/.test(open.text) ? open.text.slice(0, -1) + entry.text : `${open.text} ${entry.text}`;
        continue;
      }
      const block: Block = { text: entry.text, ...(heading ? { heading } : {}) };
      blocks.push(block);
      if (heading) open = null;
      else if (running) open = block;
    }
  }
  return blocks;
}

/** A deck is drawn on wide pages; a paper or handout on tall ones. */
export const isDeck = (pages: PdfPage[]) => pages.length > 0 && pages.filter((page) => page.width > page.height * 1.15).length >= pages.length * 0.8;

/** "D:20260923221412+00'00'" → "2026-09-23" */
const pdfDate = (value = "") => value.match(/^D:(\d{4})(\d{2})(\d{2})/)?.slice(1).join("-") ?? "";

const fileTitle = (url: string) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "").replace(/\.pdf$/i, ""); } catch { return ""; }
};

/**
 * The PDF as an HTML page, or null when it has no text to read. `picture` gives the address of
 * a page's picture; with it, each slide that shows more than text carries its picture.
 */
export function pdfHtml(pages: PdfPage[], info: PdfInfo, url: string, picture?: (page: number) => string): string | null {
  const deck = isDeck(pages);
  let title = "", body = "";
  if (deck) {
    const found = slides(pages).filter((slide) => picture || slide.title || slide.points.length);
    // Pictures alone are a scan: there is nothing to read out.
    if (found.reduce((length, slide) => length + slide.title.length + slide.points.join(" ").length, 0) < MIN_TEXT) return null;
    title = found[0]?.page === 1 ? found[0].title : "";
    body = found.map((slide) => {
      const name = `Slide ${slide.page}`;
      const image = picture && slide.pictured ? `<img data-slide src="${escape(picture(slide.page))}" alt="${escape(slide.title ? `${name}: ${slide.title}` : name)}">` : "";
      const points = slide.points.length ? `<p>${escape(slide.points.map(sentence).join(" "))}</p>` : "";
      // The opening slide's title is the deck's.
      return (slide.page === 1 && slide.title === title ? "" : `<h2>${escape(slide.title || name)}</h2>`) + image + points;
    }).join("\n");
  } else {
    const blocks = paragraphs(pages);
    title = blocks.find((b) => b.heading === 1)?.text ?? "";
    body = blocks.filter((b) => b.heading !== 1).map((b) => b.heading ? `<h2>${escape(b.text)}</h2>` : `<p>${escape(b.text)}</p>`).join("\n");
  }
  if (tidy(body.replace(/<[^>]+>/g, " ")).length < MIN_TEXT) return null;
  // Files often carry the name of the program's document, not a title: "Microsoft PowerPoint - lec1.pptx".
  const named = tidy(info.title ?? "");
  title = title || (named && !/\.\w{3,4}$|^untitled/i.test(named) ? named : "") || fileTitle(url) || "PDF";
  const date = pdfDate(info.created);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>`
    + (info.author?.trim() ? `<meta name="author" content="${escape(tidy(info.author))}">` : "")
    + (date ? `<meta name="date" content="${date}">` : "")
    + `</head><body><article data-pdf="${deck ? "slides" : "document"}"><h1>${escape(title)}</h1>\n${body}</article></body></html>`;
}

/** What pdf.js reports: runs of text, and the marks around them (`actualText` comes from our patch to pdf.js). */
type RawItem = { str: string; transform: number[]; width: number; height: number }
  | { type: "beginMarkedContent" | "beginMarkedContentProps" | "endMarkedContent"; actualText?: string | null };

/**
 * A page's runs of text. Where the file says what a stretch of glyphs really spells, that
 * replaces them: Keynote draws "tt" and "ti" as single glyphs that otherwise read as "=" or "4".
 * Text set sideways is left out; it is a margin stamp or an axis label.
 */
export function pageItems(raw: RawItem[]): PdfItem[] {
  const items: PdfItem[] = [];
  /** One entry per open mark; the replaced stretch, where the mark carries its text */
  const marks: ({ text: string; first: PdfItem | null; right: number } | null)[] = [];
  for (const item of raw) {
    if ("type" in item) {
      if (item.type !== "endMarkedContent") { marks.push(item.actualText ? { text: item.actualText, first: null, right: 0 } : null); continue; }
      const mark = marks.pop();
      if (mark?.first && !marks.some(Boolean)) items.push({ ...mark.first, str: mark.text, width: mark.right - mark.first.x });
      continue;
    }
    const [a, b, , , x, y] = item.transform;
    if (Math.abs(b) > Math.abs(a)) continue;
    const run: PdfItem = { str: item.str, x, y, width: item.width, height: item.height };
    const mark = marks.find(Boolean);
    // The space before a replaced stretch is reported inside it, and belongs to the line.
    if (!mark || (!mark.first && !item.str.trim())) { items.push(run); continue; }
    mark.first ??= run;
    mark.right = Math.max(mark.right, x + item.width);
  }
  return items;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: number[]): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** What the page's drawing instructions paint besides text: each picture and where it lands, and how many shapes. */
export function pageDrawing(ops: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }, codes: Record<string, number>, width: number, height: number): PdfDrawing {
  const paints = new Set(Object.entries(codes).filter(([name]) => /^paint(?:Inline)?Image/.test(name)).map(([, code]) => code));
  const images: PdfDrawing["images"] = [];
  let paths = 0;
  // A picture is drawn into a unit square; the transforms in force say where that square lands.
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const code = ops.fnArray[i];
    const args = (ops.argsArray[i] ?? []) as unknown[];
    if (code === codes.save) saved.push(matrix);
    else if (code === codes.restore) matrix = saved.pop() ?? matrix;
    else if (code === codes.transform) matrix = multiply(matrix, args as number[]);
    else if (code === codes.paintFormXObjectBegin) { saved.push(matrix); if (Array.isArray(args[0])) matrix = multiply(matrix, args[0] as number[]); }
    else if (code === codes.paintFormXObjectEnd) matrix = saved.pop() ?? matrix;
    else if (code === codes.constructPath) paths++;
    else if (paints.has(code)) {
      const w = Math.hypot(matrix[0], matrix[1]), h = Math.hypot(matrix[2], matrix[3]);
      const pixels = args[0] as { width?: number; height?: number } | string | undefined;
      const size = typeof pixels === "string" ? `${args[1]}x${args[2]}` : `${pixels?.width}x${pixels?.height}`;
      images.push({
        area: Math.min(1, (w * h) / (width * height)),
        at: `${Math.round(matrix[4])},${Math.round(matrix[5])},${Math.round(w)},${Math.round(h)},${size}`,
        id: typeof pixels === "string" ? pixels : "inline",
      });
    }
  }
  return { images, paths };
}

/** Where pdf.js keeps the fonts and character maps it needs to draw files that do not carry their own. */
async function pdfAssets() {
  const { createRequire } = await import("node:module");
  const { dirname } = await import("node:path");
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  return { standardFontDataUrl: `${root}/standard_fonts/`, cMapUrl: `${root}/cmaps/`, cMapPacked: true, wasmUrl: `${root}/wasm/`, iccUrl: `${root}/iccs/` };
}

/** Read a PDF's text layer page by page, and what each slide draws. Throws when the file cannot be opened. */
export async function readPdf(bytes: Uint8Array): Promise<{ pages: PdfPage[]; info: PdfInfo }> {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false, disableFontFace: true });
  try {
    const doc = await task.promise;
    const meta = await doc.getMetadata().catch(() => null);
    const raw = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown; CreationDate?: unknown };
    const text = (value: unknown) => typeof value === "string" ? value : undefined;
    const pages: PdfPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ includeMarkedContent: true });
      // Only a slide's pictures are shown, so a tall page's drawing is not worth reading.
      const drawing = width > height * 1.15 ? await page.getOperatorList().then((ops) => pageDrawing(ops, OPS, width, height)).catch(() => undefined) : undefined;
      pages.push({ width, height, items: pageItems(content.items as RawItem[]), ...(drawing ? { drawing } : {}) });
      page.cleanup();
    }
    return { pages, info: { title: text(raw.Title), author: text(raw.Author), created: text(raw.CreationDate) } };
  } finally {
    await task.destroy();
  }
}

/** Draw pages of a PDF as JPEG pictures, handing each over as it is finished. Throws when the file cannot be opened. */
export async function drawPages(bytes: Uint8Array, wanted: number[], each: (page: number, jpeg: Buffer) => Promise<void>): Promise<void> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false, disableFontFace: true, ...await pdfAssets() });
  try {
    const doc = await task.promise;
    for (const n of wanted) {
      if (!Number.isInteger(n) || n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: PICTURE_WIDTH / base.width });
        // pdf.js draws on @napi-rs/canvas outside a browser.
        const factory = doc.canvasFactory as CanvasFactory;
        const made = factory.create(Math.round(viewport.width), Math.round(viewport.height));
        await page.render({ canvas: made.canvas as never, canvasContext: made.context as never, viewport }).promise;
        await each(n, made.canvas.toBuffer("image/jpeg", 80));
        factory.destroy(made);
      } catch { /* One page that cannot be drawn leaves the others. */ }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}

interface Drawn {
  canvas: { toBuffer(type: "image/jpeg", quality: number): Buffer };
  context: unknown;
}
interface CanvasFactory {
  create(width: number, height: number): Drawn;
  destroy(drawn: Drawn): void;
}

/** Keeps pictures of a deck's slides, and says where each will be served from. */
export interface SlidePictures {
  /** The address of each page's picture, for the pages of this file that will be wanted */
  for(bytes: Uint8Array): { url(page: number): string; keep(): Promise<void> };
}

/**
 * The PDF as an HTML page, or null when it cannot be opened or has no text layer. With somewhere
 * to keep them, a deck's slides that show more than text come with their pictures.
 */
export async function pdfPage(bytes: Uint8Array, url: string, pictures?: SlidePictures): Promise<string | null> {
  try {
    const { pages, info } = await readPdf(bytes);
    const deck = pictures?.for(bytes);
    const html = pdfHtml(pages, info, url, deck?.url);
    if (html) await deck?.keep().catch(() => { /* The text still reads without its pictures. */ });
    return html;
  } catch {
    return null;
  }
}
