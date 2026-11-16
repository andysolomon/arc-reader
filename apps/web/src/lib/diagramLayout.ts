import type { DiagramItem, DiagramSpec, ListSpec } from "./articleDiagram";

/**
 * Lays a diagram out at the width the reader has, so its text stays at reading size instead of being
 * scaled down with a fixed drawing. Pure: the component only paints what comes back. The metrics follow
 * the diagram-design skill's ReadAloud skin: sans names, smaller muted notes, tracked mono tags, every
 * box on a 4-pixel grid, and one accent for the focus.
 */
export type TextRole = "name" | "note" | "tag" | "point";
export interface TextStyle {
  size: number;
  lineHeight: number;
  /** Average advance of a narrow character, in em; a wide (CJK) character costs a whole em */
  advance: number;
}
export const TEXT: Record<TextRole, TextStyle> = {
  // System sans draws at about 0.47em; the margin covers bold, capitals, and wider platform faces.
  name: { size: 13, lineHeight: 18, advance: 0.55 },
  note: { size: 12, lineHeight: 16, advance: 0.52 },
  // Mono at 0.62em, plus 0.12em of tracking, uppercase.
  tag: { size: 10, lineHeight: 14, advance: 0.74 },
  point: { size: 13, lineHeight: 18, advance: 0.52 },
};

export type Point = [number, number];
export type Shape =
  | { kind: "box"; x: number; y: number; w: number; h: number; tone: "plain" | "focal" | "hub" }
  /** `y` is the top of the first line; the painter places baselines from TEXT */
  | { kind: "text"; x: number; y: number; lines: string[]; role: TextRole; anchor: "start" | "middle" | "end"; focal?: boolean }
  | { kind: "line"; points: Point[]; head: boolean }
  | { kind: "dot"; x: number; y: number; r: number; focal?: boolean };
export interface DiagramLayout {
  width: number;
  height: number;
  shapes: Shape[];
}

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 720;
const PAD = 12;
const floor4 = (n: number) => Math.floor(n / 4) * 4;
const ceil4 = (n: number) => Math.ceil(n / 4) * 4;

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
export function measure(text: string, role: TextRole): number {
  const { size, advance } = TEXT[role];
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? size : size * advance;
  return width;
}

/** Greedy word wrap by measured width; a word wider than the line is broken, and overflow ends in an ellipsis. */
export function wrap(text: string, width: number, role: TextRole, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  const fits = (value: string) => measure(value, role) <= width;
  for (const word of text.split(" ").filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (fits(next)) { current = next; continue; }
    if (current) lines.push(current);
    current = "";
    let rest = word;
    while (!fits(rest)) {
      let cut = 1;
      const chars = [...rest];
      while (cut < chars.length && fits(chars.slice(0, cut + 1).join(""))) cut++;
      lines.push(chars.slice(0, cut).join(""));
      rest = chars.slice(cut).join("");
    }
    current = rest;
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && !fits(`${last}…`)) last = [...last].slice(0, -1).join("");
  kept[maxLines - 1] = `${last.replace(/[\s,;:.–—-]+$/, "")}…`;
  return kept;
}

const textHeight = (lines: string[], role: TextRole) => lines.length * TEXT[role].lineHeight;

interface Piece { role: TextRole; lines: string[]; gap: number }
/** Tag, name, and note stacked inside a box, measured once and painted wherever the layout puts the box. */
interface Card {
  w: number;
  h: number;
  draw: (x: number, y: number, h?: number) => Shape[];
}

function pieces(entry: DiagramItem, inner: number, opts: { note?: boolean; tag?: string }): Piece[] {
  const out: Piece[] = [];
  const tag = opts.tag ?? entry.tag;
  if (tag) out.push({ role: "tag", lines: wrap(tag.toUpperCase(), inner, "tag", 1), gap: 0 });
  out.push({ role: "name", lines: wrap(entry.label, inner, "name", 3), gap: out.length ? 4 : 0 });
  if (opts.note !== false && entry.note) out.push({ role: "note", lines: wrap(entry.note, inner, "note", 4), gap: 4 });
  return out;
}

const stackHeight = (list: Piece[]) => list.reduce((sum, piece) => sum + piece.gap + textHeight(piece.lines, piece.role), 0);

function paint(list: Piece[], x: number, y: number, anchor: "start" | "middle", focal: boolean): Shape[] {
  const shapes: Shape[] = [];
  let top = y;
  for (const piece of list) {
    top += piece.gap;
    shapes.push({ kind: "text", x, y: top, lines: piece.lines, role: piece.role, anchor, focal: focal && piece.role !== "note" });
    top += textHeight(piece.lines, piece.role);
  }
  return shapes;
}

function card(entry: DiagramItem, w: number, opts: { focal?: boolean; hub?: boolean; note?: boolean; tag?: string; center?: boolean } = {}): Card {
  const list = pieces(entry, w - 2 * PAD, opts);
  const h = ceil4(stackHeight(list) + 2 * PAD);
  return {
    w, h,
    draw: (x, y, height = h) => [
      { kind: "box", x, y, w, h: height, tone: opts.hub ? "hub" : opts.focal ? "focal" : "plain" },
      ...paint(list, opts.center ? x + w / 2 : x + PAD, y + (height - h) / 2 + PAD, opts.center ? "middle" : "start", !!opts.focal),
    ],
  };
}

/** Where the segment from a box's centre towards a point leaves the box, `gap` pixels out. */
function exit(cx: number, cy: number, tx: number, ty: number, halfW: number, halfH: number, gap = 6): Point {
  const dx = tx - cx;
  const dy = ty - cy;
  const t = Math.min(dx ? (halfW + gap) / Math.abs(dx) : Infinity, dy ? (halfH + gap) / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

const step = (i: number) => String(i + 1).padStart(2, "0");

/** Cards one under another, joined by arrows; a cycle adds the way back up on the right. */
function column(spec: ListSpec, width: number): DiagramLayout {
  const loop = spec.type === "cycle";
  const w = Math.min(floor4(width - (loop ? 32 : 0)), 480);
  const x = loop ? 0 : floor4((width - w) / 2);
  const gap = 32;
  const shapes: Shape[] = [];
  const mids: number[] = [];
  let y = 0;
  spec.items.forEach((entry, i) => {
    const c = card(entry, w, { focal: spec.focus === i, tag: entry.tag ?? (loop ? undefined : step(i)) });
    if (i > 0) shapes.push({ kind: "line", points: [[x + w / 2, y - gap + 4], [x + w / 2, y - 4]], head: true });
    shapes.push(...c.draw(x, y));
    mids.push(y + c.h / 2);
    y += c.h + gap;
  });
  if (loop) {
    const out = x + w + 16;
    shapes.push({ kind: "line", points: [[x + w + 4, mids[mids.length - 1]], [out, mids[mids.length - 1]], [out, mids[0]], [x + w + 4, mids[0]]], head: true });
  }
  return { width, height: y - gap, shapes };
}

function flow(spec: ListSpec, width: number): DiagramLayout {
  const n = spec.items.length;
  const gap = 28;
  const w = floor4((width - (n - 1) * gap) / n);
  if (n > 4 || w < 120) return column(spec, width);
  const cards = spec.items.map((entry, i) => card(entry, w, { focal: spec.focus === i, tag: entry.tag ?? step(i) }));
  const h = Math.max(...cards.map((c) => c.h));
  const ox = floor4((width - (n * w + (n - 1) * gap)) / 2);
  const shapes: Shape[] = [];
  cards.forEach((c, i) => {
    const x = ox + i * (w + gap);
    if (i > 0) shapes.push({ kind: "line", points: [[x - gap + 4, h / 2], [x - 4, h / 2]], head: true });
    shapes.push(...c.draw(x, 0, h));
  });
  return { width, height: h, shapes };
}

const overlaps = (a: Point, b: Point, w: number, h: number, margin: number) =>
  Math.abs(a[0] - b[0]) < w + margin && Math.abs(a[1] - b[1]) < h + margin;

/** Stages around an ellipse, tall enough that no two cards touch; a narrow screen gets the column. */
function cycle(spec: ListSpec, width: number): DiagramLayout {
  const n = spec.items.length;
  if (width < 480) return column(spec, width);
  const w = Math.min(176, floor4((width - 48) / 3));
  const cards = spec.items.map((entry, i) => card(entry, w, { focal: spec.focus === i, center: true }));
  const h = Math.max(...cards.map((c) => c.h));
  const rx = (width - w) / 2;
  const angles = cards.map((_, i) => -Math.PI / 2 + (2 * Math.PI * i) / n);
  const arrows = (centres: Point[]) => centres.map(([cx, cy], i): [Point, Point] => {
    const [nx, ny] = centres[(i + 1) % n];
    return [exit(cx, cy, nx, ny, w / 2, h / 2), exit(nx, ny, cx, cy, w / 2, h / 2)];
  });
  // Tall enough that no cards touch and every arrow is long enough to read as one.
  let centres: Point[] | null = null;
  for (let ry = ceil4(h * 0.75); ry <= 480; ry += 4) {
    const candidate = angles.map((a): Point => [width / 2 + rx * Math.cos(a), ry + h / 2 + ry * Math.sin(a)]);
    if (candidate.every((a, i) => candidate.every((b, j) => j <= i || !overlaps(a, b, w, h, 24)))
      && arrows(candidate).every(([[x1, y1], [x2, y2]]) => Math.hypot(x2 - x1, y2 - y1) >= 40)) { centres = candidate; break; }
  }
  if (!centres) return column(spec, width);
  const shapes: Shape[] = arrows(centres).map((points): Shape => ({ kind: "line", points, head: true }));
  centres.forEach(([cx, cy], i) => shapes.push(...cards[i].draw(cx - w / 2, cy - h / 2, h)));
  const height = Math.max(...centres.map(([, cy]) => cy + h / 2));
  return { width, height: ceil4(height), shapes };
}

/** Bands from top to bottom; on a wide screen the name sits left and the note right. */
function layers(spec: ListSpec, width: number): DiagramLayout {
  const shapes: Shape[] = [];
  const split = width >= 420;
  const nameW = split ? floor4(width * 0.36) : width - 2 * PAD;
  const noteX = PAD + nameW + 16;
  const noteW = width - noteX - PAD;
  let y = 0;
  spec.items.forEach((entry, i) => {
    const focal = spec.focus === i;
    const left = pieces(entry, nameW, { note: !split });
    const right: Piece[] = split && entry.note ? [{ role: "note", lines: wrap(entry.note, noteW, "note", 4), gap: 0 }] : [];
    const h = ceil4(Math.max(stackHeight(left), stackHeight(right)) + 2 * PAD);
    shapes.push({ kind: "box", x: 0, y, w: width, h, tone: focal ? "focal" : "plain" });
    shapes.push(...paint(left, PAD, y + (h - stackHeight(left)) / 2, "start", focal));
    if (right.length) shapes.push(...paint(right, noteX, y + (h - stackHeight(right)) / 2, "start", false));
    y += h + 8;
  });
  return { width, height: y - 8, shapes };
}

/** A rail with a dot per event: dates in a column to its left when there is room, above the name when not. */
function timeline(spec: ListSpec, width: number): DiagramLayout {
  const split = width >= 420;
  const tagW = 104;
  const rail = split ? tagW + 16 : 6;
  const textX = rail + 20;
  const textW = width - textX;
  const shapes: Shape[] = [];
  const dots: Shape[] = [];
  let y = 0;
  let first = 0;
  let last = 0;
  spec.items.forEach((entry, i) => {
    const focal = spec.focus === i;
    const tag = split && entry.tag ? wrap(entry.tag.toUpperCase(), tagW, "tag", 2) : [];
    const body = pieces(entry, textW, { tag: split ? "" : undefined });
    const h = Math.max(textHeight(tag, "tag") + 2, stackHeight(body));
    // The dot sits on the name's first line.
    const nameTop = body[0].role === "tag" ? textHeight(body[0].lines, "tag") + body[1].gap : 0;
    const dotY = y + nameTop + TEXT.name.lineHeight / 2;
    if (i === 0) first = dotY;
    last = dotY;
    if (tag.length) shapes.push({ kind: "text", x: tagW, y: dotY - TEXT.tag.lineHeight / 2, lines: tag, role: "tag", anchor: "end", focal });
    shapes.push(...paint(body, textX, y, "start", focal));
    dots.push({ kind: "dot", x: rail, y: dotY, r: focal ? 5 : 4, focal });
    y += h + 20;
  });
  return { width, height: y - 20, shapes: [{ kind: "line", points: [[rail, first], [rail, last]], head: false }, ...dots, ...shapes] };
}

/** The centre with its parts in two columns either side, joined by buses; narrow screens hang them below. */
function hub(spec: Extract<DiagramSpec, { type: "hub" }>, width: number): DiagramLayout {
  const shapes: Shape[] = [];
  const centreLabel: DiagramItem = { label: spec.center };
  if (width < 560) {
    const centre = card(centreLabel, width, { hub: true, center: true });
    const indent = 32;
    let y = centre.h + 16;
    spec.items.forEach((entry, i) => {
      const c = card(entry, width - indent, { focal: spec.focus === i });
      shapes.push({ kind: "line", points: [[16, centre.h], [16, y + c.h / 2], [indent - 4, y + c.h / 2]], head: false });
      shapes.push(...c.draw(indent, y));
      y += c.h + 12;
    });
    return { width, height: y - 12, shapes: [...shapes, ...centre.draw(0, 0)] };
  }
  const centreW = 168;
  const gapX = 56;
  const colW = floor4((width - centreW - 2 * gapX) / 2);
  const centre = card(centreLabel, centreW, { hub: true, center: true });
  const half = Math.ceil(spec.items.length / 2);
  const sides = [spec.items.slice(0, half), spec.items.slice(half)].map((list, side) =>
    list.map((entry, k) => card(entry, colW, { focal: spec.focus === k + side * half })));
  const columnHeight = (cards: Card[]) => cards.reduce((sum, c) => sum + c.h, 0) + Math.max(0, cards.length - 1) * 16;
  const height = Math.max(centre.h, ...sides.map(columnHeight));
  const midY = height / 2;
  const centreX = colW + gapX;
  sides.forEach((cards, side) => {
    let y = (height - columnHeight(cards)) / 2;
    const x = side === 0 ? 0 : centreX + centreW + gapX;
    const edge = side === 0 ? centreX : centreX + centreW;
    const bus = side === 0 ? colW + gapX / 2 : edge + gapX / 2;
    const near = side === 0 ? colW + 4 : x - 4;
    for (const c of cards) {
      const mid = y + c.h / 2;
      shapes.push({ kind: "line", points: [[edge, midY], [bus, midY], [bus, mid], [near, mid]], head: false });
      shapes.push(...c.draw(x, y));
      y += c.h + 16;
    }
  });
  return { width, height: ceil4(height), shapes: [...shapes, ...centre.draw(centreX, (height - centre.h) / 2)] };
}

/** Two or three columns of parallel points under their headings; stacked when the columns would be cramped. */
function compare(spec: Extract<DiagramSpec, { type: "compare" }>, width: number): DiagramLayout {
  const n = spec.groups.length;
  const gap = 24;
  const sideBySide = (width - (n - 1) * gap) / n >= 200;
  const colW = sideBySide ? floor4((width - (n - 1) * gap) / n) : width;
  const heads = spec.groups.map((group, i) => card({ label: group.label }, colW, { focal: spec.focus === i }));
  const headH = sideBySide ? Math.max(...heads.map((c) => c.h)) : 0;
  const shapes: Shape[] = [];
  let y = 0;
  let height = 0;
  spec.groups.forEach((group, i) => {
    const x = sideBySide ? i * (colW + gap) : 0;
    let top = sideBySide ? 0 : y;
    const h = headH || heads[i].h;
    shapes.push(...heads[i].draw(x, top, h));
    top += h + 12;
    for (const point of group.points) {
      const lines = wrap(point, colW - 20, "point", 4);
      const markY = top + TEXT.point.lineHeight / 2;
      shapes.push({ kind: "line", points: [[x + 4, markY], [x + 12, markY]], head: false });
      shapes.push({ kind: "text", x: x + 20, y: top, lines, role: "point", anchor: "start" });
      top += textHeight(lines, "point") + 8;
    }
    height = Math.max(height, top - 8);
    y = top - 8 + 28;
  });
  return { width, height, shapes };
}

export function layoutDiagram(spec: DiagramSpec, available: number): DiagramLayout {
  const width = floor4(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, available)));
  switch (spec.type) {
    case "flow": return flow(spec, width);
    case "cycle": return cycle(spec, width);
    case "layers": return layers(spec, width);
    case "timeline": return timeline(spec, width);
    case "hub": return hub(spec, width);
    case "compare": return compare(spec, width);
  }
}
