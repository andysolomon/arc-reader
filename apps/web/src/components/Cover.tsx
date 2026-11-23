import { useState } from "react";
import { cn } from "@readaloud/ui";
import type { CoverEntry } from "../lib/coverProtocol";

/**
 * A cover: the title set in type over art drawn for it. The art has no lettering of its own,
 * so the words are always spelled as the document spells them. The page is its own paper,
 * the same in every theme, as a book's cover is.
 */

const PAPER = "#F8F8F2", INK = "#181916", COBALT = "#4050FF", QUIET = "#777971", RULE = "#D7D9D1";

/** A long title is set smaller, never cut mid-word; sizes are shares of the cover's width. */
function headlineSize(text: string, article: boolean): string {
  const n = text.length;
  const size = n <= 24 ? 11.5 : n <= 48 ? 9.2 : n <= 80 ? 7.4 : n <= 130 ? 6 : 5;
  return `${article ? size : size * 0.92}cqw`;
}

export interface CoverProps {
  cover: CoverEntry;
  /** Above the rule: the site or author for an article, the article's title for a section */
  eyebrow: string;
  /** Beside the rule at the foot */
  foot?: string;
  onRetry?: () => void;
  className?: string;
}

export function Cover({ cover, eyebrow, foot, onRetry, className }: CoverProps) {
  const [shown, setShown] = useState(false);
  const [broken, setBroken] = useState(false);
  const article = cover.kind === "article";
  const art = cover.status === "ready" && cover.url && !broken ? cover.url : null;
  const failed = cover.status === "failed" || broken;
  return (
    <figure
      data-cover={cover.kind}
      data-cover-status={broken ? "failed" : cover.status}
      className={cn("relative m-0 mx-auto w-full overflow-hidden rounded-[10px] font-sans shadow-[0_1px_2px_rgba(0,0,0,.18),0_10px_28px_-12px_rgba(0,0,0,.35)]", className)}
      // Isolated, so the art multiplies onto this page and never onto whatever theme is behind it.
      style={{ aspectRatio: "4 / 5", background: PAPER, color: INK, containerType: "inline-size", isolation: "isolate" }}
    >
      {/* The words are the page's own title or heading, which follows as text: a screen reader hears it there, and the art's description here. */}
      <div className="absolute inset-0 flex flex-col" style={{ padding: "6.5cqw 6.7cqw 5.2cqw" }}>
        <div aria-hidden className="flex items-center font-mono uppercase" style={{ gap: "2.4cqw", fontSize: "2.5cqw", letterSpacing: "0.16em", color: QUIET }}>
          <span className="shrink-0" style={{ width: "2.2cqw", height: "2.2cqw", background: COBALT }} />
          <span className="min-w-0 truncate">{eyebrow}</span>
        </div>
        <div style={{ height: 1, background: RULE, margin: "2.6cqw 0 4.4cqw" }} />
        <p aria-hidden className="m-0 [overflow-wrap:anywhere] [text-wrap:balance]" style={{ fontSize: headlineSize(cover.heading, article), fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.035em", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 6, overflow: "hidden" }}>
          {cover.heading}
        </p>
        <div className="relative min-h-0 flex-1" style={{ marginTop: "3cqw" }}>
          {art ? (
            <img
              src={art} alt={cover.alt} decoding="async" loading="lazy" onLoad={() => setShown(true)} onError={() => setBroken(true)}
              className={cn("cover-art absolute inset-0 size-full object-contain object-bottom transition-opacity duration-500 motion-reduce:transition-none", shown ? "opacity-100" : "opacity-0")}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <div className={cn("w-[62%]", !failed && "animate-pulse motion-reduce:animate-none")} style={{ aspectRatio: "1", borderRadius: "50%", border: `1px dashed ${failed ? RULE : QUIET}`, opacity: failed ? 1 : 0.55 }} />
            </div>
          )}
        </div>
        <div style={{ height: 1, background: RULE, margin: "2.6cqw 0 2.4cqw" }} />
        <div aria-hidden className="flex items-center justify-between font-mono uppercase" style={{ gap: "3cqw", fontSize: "2.3cqw", letterSpacing: "0.14em", color: QUIET }}>
          <span className="min-w-0 truncate">{foot}</span>
          <span className="shrink-0">{failed ? "No cover art" : art ? (article ? "Article" : "Section") : cover.status === "generating" ? "Drawing…" : "Cover queued"}</span>
        </div>
      </div>
      {!art && <figcaption className="sr-only">{failed ? `The cover for ${cover.heading} could not be drawn.` : `The cover for ${cover.heading} is being drawn.`}</figcaption>}
      {failed && onRetry && (
        <button
          type="button" onClick={onRetry}
          className="absolute left-1/2 top-[62%] -translate-x-1/2 rounded-pill border px-3.5 py-1.5 text-[12px] font-medium"
          style={{ background: PAPER, color: INK, borderColor: INK }}
        >
          Draw again
        </button>
      )}
    </figure>
  );
}

/** The art alone, small: what stands for a document in a list. */
export function CoverThumb({ url, className }: { url: string; className?: string }) {
  return (
    <span data-cover-thumb className={cn("relative block w-9 shrink-0 overflow-hidden rounded-[5px] ring-1 ring-line", className)} style={{ aspectRatio: "4 / 5", background: PAPER }}>
      <span aria-hidden className="absolute left-[3px] top-[3px] size-[3px]" style={{ background: COBALT }} />
      <img src={url} alt="" loading="lazy" decoding="async" className="cover-art absolute inset-x-0 bottom-0 w-full object-contain" />
    </span>
  );
}
