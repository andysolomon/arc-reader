import { useEffect, useState, type ReactNode } from "react";
import { ImageIcon, Network, ChevronDown, Presentation } from "lucide-react";
import { cn } from "../lib/cn";
import type { ParagraphLike } from "../lib/types";

export function VisualFigure({ visual, active, children }: { visual: NonNullable<ParagraphLike["visual"]>; active: boolean; children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [visual.src]);
  // A slide is there to be looked at: its picture is shown, with what is said about it underneath.
  if (visual.kind === "slide") {
    return (
      <section aria-label="Slide picture" className={cn(
        "my-8 overflow-hidden rounded-2xl border bg-bg2 font-sans transition-colors duration-base",
        active ? "border-accent shadow-[0_0_0_3px_var(--hl)]" : "border-line",
      )}>
        {failed ? <p className="m-0 border-b border-line px-5 py-4 text-sm text-fg2" role="status">The picture of this slide is unavailable.</p>
          // Most decks are 16:9; reserving that shape keeps the text from jumping as pictures load.
          : <img src={visual.src} alt={visual.alt || "Slide"} loading="lazy" decoding="async" onError={() => setFailed(true)} className="block aspect-video w-full border-b border-line bg-bg object-contain" />}
        <div className="flex flex-wrap items-center gap-2 px-5 pt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-fg2">
          <Presentation size={15} aria-hidden /><span>Slide</span>
          <span className="ml-auto text-[10px] tracking-[0.08em]">{visual.source === "description" ? "Spoken description" : "Not described yet"}</span>
        </div>
        <p className="m-0 px-5 pb-5 pt-2 text-[0.9em] leading-relaxed">{children}</p>
      </section>
    );
  }
  const label = visual.kind === "diagram" ? "Diagram" : "Image";
  const Icon = visual.kind === "diagram" ? Network : ImageIcon;
  return (
    <section aria-label={`${label} explanation`} className={cn(
      "my-8 overflow-hidden rounded-2xl border bg-bg2 font-sans transition-colors duration-base",
      active ? "border-accent shadow-[0_0_0_3px_var(--hl)]" : "border-line",
    )}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-fg2">
        <Icon size={15} aria-hidden /><span>{label}</span>
        <span className="ml-auto text-[10px] tracking-[0.08em]">{visual.source === "description" ? "Spoken description" : visual.source === "caption" ? "Article description" : "Description unavailable"}</span>
      </div>
      <p className="m-0 px-5 py-5 text-[0.9em] leading-relaxed">{children}</p>
      {visual.src && <details className="group border-t border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[12px] text-fg2 hover:text-fg [&::-webkit-details-marker]:hidden">
          <ChevronDown size={14} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          View {label.toLowerCase()}
        </summary>
        <figure className="m-0 border-t border-line bg-bg p-4">
          {failed ? <p className="m-0 text-sm text-fg2" role="status">The original {label.toLowerCase()} is unavailable. You can still listen to its description.</p>
            : <img src={visual.src} alt={visual.alt || visual.caption || `Article ${label.toLowerCase()}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="mx-auto max-h-96 max-w-full rounded-lg object-contain" />}
          {visual.caption && <figcaption className="mt-3 text-[12px] leading-relaxed text-fg2">{visual.caption}</figcaption>}
        </figure>
      </details>}
    </section>
  );
}
