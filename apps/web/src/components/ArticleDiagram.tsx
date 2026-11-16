import { RotateCw, Trash2, Workflow, X } from "lucide-react";
import { Button, IconButton, Skeleton } from "@readaloud/ui";
import type { DocRecord } from "../lib/db";
import { savedDiagram } from "../lib/articleDiagram";
import { summaryModelLabel } from "../lib/summary";
import { useSettings } from "../state/settings";
import { useDiagrams } from "../state/diagrams";
import { DiagramFigure } from "./DiagramFigure";

/** A figure breaks out of the reading measure when the Reader has room, up to this width. */
const FIGURE_WIDTH = "min(760px, 100cqw - 3rem)";

/** Diagram panel above the Reader text: a model reads the article and picks a shape; the app draws it. */
export function ArticleDiagram({ record }: { record: DocRecord }) {
  const model = useSettings((s) => s.summaryModel);
  const set = useSettings((s) => s.set);
  const pending = useDiagrams((s) => !!s.pending[record.id]);
  const error = useDiagrams((s) => s.errors[record.id]);
  const request = useDiagrams((s) => s.request);
  const remove = useDiagrams((s) => s.remove);
  const diagram = savedDiagram(record);
  const label = summaryModelLabel(diagram && !pending ? record.diagram!.model : model);
  const drawn = diagram && diagram.type !== "none" ? diagram : null;

  return (
    <section aria-label="Diagram" aria-busy={pending || undefined}
      style={{ width: `max(100%, ${FIGURE_WIDTH})`, marginInline: `calc((100% - max(100%, ${FIGURE_WIDTH})) / 2)` }}
      className="mb-10 animate-rise rounded-card border border-line bg-bg2 px-5 pb-5 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <Workflow size={16} strokeWidth={1.5} className={pending ? "animate-pulse text-fg2" : "text-fg2"} aria-hidden />
        <h2 className="m-0 flex-1 text-[13px] font-normal text-fg2">Diagram · {label}</h2>
        {diagram && !pending && (
          <>
            <IconButton label="Draw again" size={32} onClick={() => void request(record, { force: diagram.type === "none" })}>
              <RotateCw size={16} strokeWidth={1.5} />
            </IconButton>
            <IconButton label="Delete diagram" size={32} onClick={() => void remove(record)}>
              <Trash2 size={16} strokeWidth={1.5} />
            </IconButton>
          </>
        )}
        <IconButton label="Hide diagram" size={32} onClick={() => set("showDiagram", false)}>
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      </div>
      <div aria-live="polite">
        {pending ? (
          <div className="flex flex-col gap-3 py-1">
            <div className="summary-draft grid grid-cols-3 gap-6">
              <Skeleton width="100%" height={56} />
              <Skeleton width="100%" height={56} />
              <Skeleton width="100%" height={56} />
            </div>
            <p className="m-0 text-[13px] text-fg2">Drawing with {label}… this can take up to a minute.</p>
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3 py-1">
            <p className="m-0 flex-1 text-[14px] text-danger">{error}</p>
            <Button onClick={() => void request(record, { force: diagram?.type === "none" })}>Retry</Button>
          </div>
        ) : drawn ? (
          <figure className="m-0">
            <figcaption className="mb-4 font-serif text-[19px] leading-snug text-fg">{drawn.title}</figcaption>
            <DiagramFigure spec={drawn} />
            <p className="m-0 mt-4 text-[12px] text-fg2">Drawn by {label} from the article’s text. Check it against the article.</p>
          </figure>
        ) : diagram?.type === "none" ? (
          <div className="flex flex-wrap items-center gap-3 py-1">
            <p className="m-0 flex-1 text-[14px] text-fg2">No diagram: {diagram.reason}</p>
            <Button onClick={() => void request(record, { force: true })}>Draw one anyway</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 py-1">
            <p className="m-0 flex-1 text-[14px] text-fg2">
              {record.diagram ? "The text has changed since the diagram was drawn." : "See the article’s structure as a diagram."}
            </p>
            <Button variant="primary" leading={<Workflow size={16} strokeWidth={1.5} />} onClick={() => void request(record)}>
              Draw a diagram
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
