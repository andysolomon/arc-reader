import { VisualFigure } from "./VisualFigure";
import { memo, useEffect, useRef, type MouseEvent } from "react";
import { Code2, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import type { HighlightMode, ParagraphLike } from "../lib/types";
import { useReducedMotion } from "../lib/useReducedMotion";

export interface SentenceTextProps {
  paragraphs: ParagraphLike[];
  /** flat index of the active sentence, -1 for none */
  activeIndex: number;
  /** word index within the active sentence, -1 for none */
  activeWord: number;
  mode?: HighlightMode;
  /** First sentence shows as a pulsing skeleton until the first chunk arrives */
  loading?: boolean;
  fontSize?: number;
  wide?: boolean;
  onSeek?: (index: number) => void;
  /** Scroll container; when provided, the active sentence is kept one third down */
  scrollRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * The transcript. Sentences are inline spans (plain text for assistive tech: no roles,
 * no fragments). Clicks are delegated at the article level.
 */
export const SentenceText = memo(function SentenceText({
  paragraphs,
  activeIndex,
  activeWord,
  mode = "block",
  loading,
  fontSize = 19,
  wide,
  onSeek,
  scrollRef,
  className,
}: SentenceTextProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const last = useRef<Element | null>(null);

  useEffect(() => { last.current = null; }, [paragraphs]);

  useEffect(() => {
    const c = scrollRef?.current;
    const el = ref.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`);
    if (!c || !el || el === last.current) return;
    last.current = el;
    if (activeIndex === 0 && c.scrollTop === 0) return;
    const top = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - c.clientHeight / 3;
    c.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [activeIndex, paragraphs, scrollRef, reduce]);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (!onSeek) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!t || !ref.current?.contains(t)) return;
    onSeek(Number(t.dataset.i));
  };

  return (
    <article
      ref={ref}
      onClick={onClick}
      data-mode={mode}
      className={cn("mx-auto font-serif text-fg transition-[font-size,max-width] duration-base [text-wrap:pretty]", className)}
      style={{ maxWidth: `${wide ? 72 : 62}ch`, fontSize, lineHeight: 1.65 }}
    >
      {paragraphs.map((p, pi) => {
        const content = p.sentences.map((s, si) => {
            const i = p.start + si;
            const active = i === activeIndex;
            const past = i < activeIndex;
            const skeleton = loading && i === 0;
            return (
              <span
                key={i}
                data-i={i}
                className={cn(
                  "-mx-1 -my-0.5 rounded-[6px] px-1 py-0.5 transition-[background-color,color] duration-base [-webkit-box-decoration-break:clone] [box-decoration-break:clone]",
                  onSeek && "cursor-pointer hover:shadow-[inset_0_-1px_0_var(--fg3)]",
                  skeleton && "animate-pulse bg-bg3 text-transparent motion-reduce:animate-none",
                  !skeleton && mode === "block" && active && "bg-hl",
                  !skeleton && mode === "block" && past && "text-fg2",
                  !skeleton && mode === "dim" && (active ? "text-fg" : "text-fg3"),
                  !skeleton && mode === "underline" && active && "underline decoration-accent decoration-2 underline-offset-[6px]",
                )}
              >
                {active && !skeleton
                  ? s.words.map((w, wi) => (
                      <span
                        key={wi}
                        className={cn(
                          wi === activeWord &&
                            (mode === "underline"
                              ? "rounded-[3px] bg-hl"
                              : "underline decoration-accent decoration-[1.5px] underline-offset-4"),
                        )}
                      >
                        {w}
                        {wi < s.words.length - 1 ? " " : ""}
                      </span>
                    ))
                  : s.text}
                {" "}
              </span>
            );
          });
        if (p.visual) return <VisualFigure key={pi} visual={p.visual} active={activeIndex === p.start}>{content}</VisualFigure>;
        if (p.code) return (
          <section key={pi} aria-label="Code example" className={cn(
            "my-8 overflow-hidden rounded-2xl border bg-bg2 font-sans transition-colors duration-base",
            activeIndex === p.start ? "border-accent shadow-[0_0_0_3px_var(--hl)]" : "border-line",
          )}>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-fg2">
              <Code2 size={15} aria-hidden />
              <span>{p.code.language || "Code example"}</span>
              <span className="ml-auto text-[10px] tracking-[0.08em]">{p.code.summarized ? "Spoken summary" : "Skipped in audio"}</span>
            </div>
            <p className="m-0 px-5 py-5 text-[0.9em] leading-relaxed">{content}</p>
            <details className="group border-t border-line">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[12px] text-fg2 hover:text-fg [&::-webkit-details-marker]:hidden">
                <ChevronDown size={14} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                View original code
              </summary>
              <pre className="m-0 max-h-96 overflow-auto border-t border-line bg-bg p-5 font-mono text-[12px] leading-6 [tab-size:2]" tabIndex={0} aria-label="Original code">
                <code>{p.code.text}</code>
              </pre>
            </details>
          </section>
        );
        return <p key={pi} className="mb-[1.35em] mt-0 last:mb-0">{content}</p>;
      })}
    </article>
  );
});
