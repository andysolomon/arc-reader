import { memo, useEffect, useRef, type MouseEvent } from "react";
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
  const last = useRef(-2);

  useEffect(() => {
    if (activeIndex === last.current) return;
    last.current = activeIndex;
    const c = scrollRef?.current;
    const el = ref.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`);
    if (!c || !el) return;
    const top = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - c.clientHeight / 3;
    c.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [activeIndex, scrollRef, reduce]);

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
      {paragraphs.map((p, pi) => (
        <p key={pi} className="mb-[1.35em] mt-0 last:mb-0">
          {p.sentences.map((s, si) => {
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
          })}
        </p>
      ))}
    </article>
  );
});
