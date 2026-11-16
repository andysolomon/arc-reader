import { describe, expect, it } from "vitest";
import type { DiagramItem, DiagramSpec } from "./articleDiagram";
import { DIAGRAM_LIMITS } from "./articleDiagram";
import { MAX_WIDTH, TEXT, layoutDiagram, measure, wrap, type Shape } from "./diagramLayout";

const long = (i: number): DiagramItem => ({
  label: `Stage ${i} with a label near forty chars`.slice(0, 40),
  note: "A note of about twelve words that explains what this stage does and why it matters here".slice(0, 110),
  tag: `Mid ${1900 + i}s era`,
});
const items = (n: number) => Array.from({ length: n }, (_, i) => long(i));

function specs(): DiagramSpec[] {
  const out: DiagramSpec[] = [];
  for (const type of ["flow", "cycle", "layers", "timeline"] as const) {
    const [min, max] = DIAGRAM_LIMITS[type];
    for (let n = min; n <= max; n++) out.push({ type, title: "T", items: items(n), focus: n - 1 });
  }
  for (let n = 3; n <= 6; n++) out.push({ type: "hub", title: "T", center: "The central idea of it all", items: items(n), focus: 0 });
  for (let n = 2; n <= 3; n++) {
    out.push({ type: "compare", title: "T", groups: Array.from({ length: n }, (_, i) => ({ label: long(i).label, points: Array(5).fill(long(i).note!) })), focus: 0 });
  }
  return out;
}

interface Rect { x: number; y: number; w: number; h: number }
function textRect(shape: Extract<Shape, { kind: "text" }>): Rect {
  const w = Math.max(...shape.lines.map((line) => measure(line, shape.role)));
  const x = shape.anchor === "middle" ? shape.x - w / 2 : shape.anchor === "end" ? shape.x - w : shape.x;
  return { x, y: shape.y, w, h: shape.lines.length * TEXT[shape.role].lineHeight };
}
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
  && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;

describe("layoutDiagram", () => {
  for (const width of [280, 360, 420, 440, 480, 520, 600, MAX_WIDTH]) {
    it(`keeps every shape in bounds without overlaps at ${width}px`, () => {
      for (const spec of specs()) {
        const layout = layoutDiagram(spec, width);
        const where = `${spec.type} (${"items" in spec ? spec.items.length : spec.groups.length}) at ${width}`;
        const frame = { x: 0, y: 0, w: layout.width, h: layout.height };
        expect(layout.width, where).toBeLessThanOrEqual(width);
        const boxes = layout.shapes.filter((s): s is Extract<Shape, { kind: "box" }> => s.kind === "box");
        const texts = layout.shapes.filter((s): s is Extract<Shape, { kind: "text" }> => s.kind === "text").map(textRect);
        for (const box of boxes) expect(inside(box, frame), `box out of frame: ${where}`).toBe(true);
        for (const text of texts) expect(inside(text, frame), `text out of frame: ${where}`).toBe(true);
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(intersects(a, b), `boxes overlap: ${where}`).toBe(false)));
        texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => expect(intersects(a, b), `text overlaps: ${where}`).toBe(false)));
        // Every text belongs to one box when the shape uses boxes for its items, and fits inside it.
        if (spec.type !== "timeline" && spec.type !== "compare") {
          for (const text of texts) expect(boxes.some((box) => inside(text, box)), `text outside its box: ${where}`).toBe(true);
        }
        for (const line of layout.shapes.filter((s) => s.kind === "line")) {
          for (const [x, y] of line.points) expect(inside({ x, y, w: 0, h: 0 }, frame), `line out of frame: ${where}`).toBe(true);
        }
      }
    });
  }

  it("draws a short flow across and a long one down", () => {
    const across = layoutDiagram({ type: "flow", title: "T", items: items(3) }, 680);
    const down = layoutDiagram({ type: "flow", title: "T", items: items(6) }, 680);
    const ys = (layout: typeof across) => new Set(layout.shapes.filter((s) => s.kind === "box").map((s) => s.y));
    expect(ys(across).size).toBe(1);
    expect(ys(down).size).toBe(6);
  });

  it("marks only the focus with the accent", () => {
    const layout = layoutDiagram({ type: "layers", title: "T", items: items(4), focus: 2 }, 600);
    expect(layout.shapes.filter((s) => s.kind === "box" && s.tone === "focal")).toHaveLength(1);
  });
});

describe("wrap", () => {
  it("breaks at words, breaks a word wider than the line, and ends overflow in an ellipsis", () => {
    expect(wrap("one two three", 60, "name", 3)).toEqual(["one two", "three"]);
    expect(wrap("abcdefghijklmnop", 40, "name", 5).every((line) => measure(line, "name") <= 40)).toBe(true);
    const cut = wrap("one two three four five six seven", 60, "name", 2);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith("…")).toBe(true);
    expect(measure(cut[1], "name")).toBeLessThanOrEqual(60);
  });

  it("counts a wide character as a whole em", () => {
    expect(measure("結果", "name")).toBe(26);
    expect(wrap("請求項比對請求項比對", 60, "name", 4).every((line) => measure(line, "name") <= 60)).toBe(true);
  });
});
