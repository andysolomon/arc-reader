import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { diagramDescription, type DiagramSpec } from "../lib/articleDiagram";
import { TEXT, layoutDiagram, type Shape, type TextRole } from "../lib/diagramLayout";

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
/** Drawn with the theme's own colours, so a diagram reads in every theme the app has. */
const FONT: Record<TextRole, CSSProperties> = {
  name: { fontFamily: SANS, fontSize: TEXT.name.size, fontWeight: 600, fill: "var(--fg)" },
  note: { fontFamily: SANS, fontSize: TEXT.note.size, fill: "var(--fg2)" },
  tag: { fontFamily: MONO, fontSize: TEXT.tag.size, fontWeight: 500, letterSpacing: "0.12em", fill: "var(--fg2)" },
  point: { fontFamily: SANS, fontSize: TEXT.point.size, fill: "var(--fg)" },
};
const BOX: Record<"plain" | "focal" | "hub", CSSProperties> = {
  plain: { fill: "var(--bg)", stroke: "var(--line)", strokeWidth: 1 },
  focal: { fill: "color-mix(in srgb, var(--accent) 10%, var(--bg))", stroke: "var(--accent)", strokeWidth: 1.2 },
  hub: { fill: "var(--bg3)", stroke: "var(--fg2)", strokeWidth: 1.2 },
};
/** The inset that keeps strokes on the edge from being cut off */
const INSET = 2;

function paint(shape: Shape, key: number, marker: string) {
  switch (shape.kind) {
    case "box":
      return <rect key={key} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={6} style={BOX[shape.tone]} />;
    case "dot":
      return <circle key={key} cx={shape.x} cy={shape.y} r={shape.r} style={shape.focal ? { fill: "var(--accent)" } : { fill: "var(--bg)", stroke: "var(--fg2)", strokeWidth: 1.2 }} />;
    case "line":
      return (
        <polyline key={key} points={shape.points.map(([x, y]) => `${x},${y}`).join(" ")} markerEnd={shape.head ? `url(#${marker})` : undefined}
          style={{ fill: "none", stroke: "var(--fg2)", strokeWidth: 1, strokeLinejoin: "round" }} />
      );
    case "text": {
      const { size, lineHeight } = TEXT[shape.role];
      // Centre each line's x-height in its line box.
      const baseline = shape.y + (lineHeight - size) / 2 + size * 0.8;
      return (
        <text key={key} x={shape.x} y={baseline} textAnchor={shape.anchor}
          style={{ ...FONT[shape.role], ...(shape.focal && { fill: "var(--accent)" }) }}>
          {shape.lines.map((line, i) => <tspan key={i} x={shape.x} dy={i ? lineHeight : 0}>{line}</tspan>)}
        </text>
      );
    }
  }
}

/** An article diagram drawn at a given width. React escapes every label; nothing here is model markup. */
export function DiagramSvg({ spec, width }: { spec: DiagramSpec; width: number }) {
  const marker = `diagram-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layout = useMemo(() => layoutDiagram(spec, width - 2 * INSET), [spec, width]);
  const description = useMemo(() => diagramDescription(spec), [spec]);
  const w = layout.width + 2 * INSET;
  const h = layout.height + 2 * INSET;
  return (
    <svg role="img" aria-label={description} width={w} height={h} viewBox={`${-INSET} ${-INSET} ${w} ${h}`} className="mx-auto block max-w-full">
      <defs>
        <marker id={marker} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={8} markerHeight={8} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0.5 L7.5,4 L0,7.5 z" style={{ fill: "var(--fg2)" }} />
        </marker>
      </defs>
      {layout.shapes.map((shape, i) => paint(shape, i, marker))}
    </svg>
  );
}

/** Lays the diagram out again whenever the space it has changes, so its text stays at reading size. */
export function DiagramFigure({ spec, className }: { spec: DiagramSpec; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setAvailable(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setAvailable(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-diagram={spec.type} className={className}>
      {available > 0 && <DiagramSvg spec={spec} width={available} />}
    </div>
  );
}
