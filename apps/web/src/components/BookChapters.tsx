import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { Button, cn } from "@readaloud/ui";
import type { DocRecord } from "../lib/db";
import { openDocument } from "../lib/openDoc";
import { useBooks, shelves, finished } from "../state/books";
import { useLibrary, type LibraryItem } from "../state/library";
import { usePlayer } from "../state/player";

/**
 * Shown on a document whose page revealed a book: offers the chapters the library is missing,
 * then reports them arriving. A contents page gives way to the first chapter once it is in.
 */
export function BookOffer({ record }: { record: DocRecord }) {
  const navigate = useNavigate();
  const offer = useBooks((s) => s.offers[record.id]);
  const bookId = offer?.id ?? record.book?.id;
  const adding = useBooks((s) => (bookId ? s.adding[bookId] : undefined));
  const items = useLibrary((s) => s.items);

  if (adding) {
    return (
      <div role="status" data-book-progress className="mb-8 rounded-card border border-line bg-bg2 px-5 py-4 font-sans text-[14px] text-fg2">
        <div className="flex items-center gap-3">
          <BookOpen size={18} strokeWidth={1.5} className="shrink-0" aria-hidden />
          <span className="flex-1">Adding chapters of {offer?.title ?? record.book?.title}</span>
          <span className="tabular-nums">{adding.done} of {adding.total}</span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg3" aria-hidden>
          <span className="block h-full rounded-full bg-accent transition-[width] duration-base" style={{ width: `${adding.total ? (adding.done / adding.total) * 100 : 0}%` }} />
        </div>
      </div>
    );
  }
  if (!offer) return null;

  const have = new Set(shelves(items).get(offer.id)?.items.map((it) => it.rec.book!.chapter));
  const missing = offer.chapters.filter((_, index) => !have.has(index + 1)).length;
  if (!missing) return null;
  const contents = offer.index === null;
  const total = offer.chapters.length;

  const add = () => {
    void useBooks.getState().add(offer, contents ? {
      // The contents page has done its job: read the book from chapter one instead.
      async onFirst(first) {
        const reading = usePlayer.getState().doc?.id === record.id;
        if (reading && window.location.pathname.endsWith(`/read/${record.id}`)) await openDocument(first, navigate, { autoplay: true, resume: false, prepare: true, replace: true });
        else if (reading) usePlayer.getState().close();
        await useLibrary.getState().remove(record.id);
      },
    } : {});
  };

  return (
    <aside aria-label="Book" data-book-offer className="mb-8 rounded-card border border-line bg-bg2 px-5 py-4 font-sans">
      <div className="flex items-start gap-3">
        <BookOpen size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg2" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] leading-relaxed text-fg">
            {contents
              ? <>This page lists the {total} chapters of <cite className="font-serif">{offer.title}</cite>.</>
              : <>This is chapter {offer.index! + 1} of {total} in <cite className="font-serif">{offer.title}</cite>.</>}
          </p>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-fg2">
            {contents
              ? "Add them to read the book in order. The chapters take this page's place in your Library."
              : "Add the others to read the book in order."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={add}>{contents || missing === total ? `Add ${missing} chapters` : missing === 1 ? "Add the other chapter" : `Add the other ${missing} chapters`}</Button>
            <Button variant="ghost" onClick={() => useBooks.getState().dismiss(record.id)}>Not now</Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** For a chapter whose book is only partly in the library: fetch the rest, whenever you get round to it. */
export function MissingChapters({ record, className }: { record: DocRecord; className?: string }) {
  const offered = useBooks((s) => !!s.offers[record.id]);
  const adding = useBooks((s) => !!(record.book && s.adding[record.book.id]));
  const items = useLibrary((s) => s.items);
  const loaded = useLibrary((s) => s.loaded);
  if (!record.book || !record.meta?.url || offered || adding || !loaded) return null;
  const have = new Set(shelves(items).get(record.book.id)?.items.map((it) => it.rec.book!.chapter)).size;
  const missing = Math.max(record.book.chapters, record.book.chapter) - have;
  if (missing <= 0) return null;
  return (
    <Button variant="link" className={cn("font-sans text-[12px] text-accent underline-offset-2 hover:underline", className)} onClick={() => void useBooks.getState().complete(record)}>
      {missing === 1 ? "Add the missing chapter" : `Add the ${missing} missing chapters`}
    </Button>
  );
}

/** "Chapter 8 of 27" */
export const chapterLabel = (rec: DocRecord) => rec.book ? `Chapter ${rec.book.chapter} of ${Math.max(rec.book.chapters, rec.book.chapter)}` : "";

/** Open a chapter where it was left, or from the top once it has been finished. */
export function useOpenChapter() {
  const navigate = useNavigate();
  return (it: LibraryItem) => void openDocument(it.rec, navigate, { autoplay: true, resume: !finished(it), prepare: true });
}

/** The chapters either side of this one, at the foot of the text. */
export function ChapterNav({ previous, next, className }: { previous?: LibraryItem; next?: LibraryItem; className?: string }) {
  const open = useOpenChapter();
  if (!previous && !next) return null;
  const card = "flex min-w-0 flex-1 basis-56 flex-col gap-1 rounded-card border border-line bg-bg2 px-5 py-4 text-left font-sans transition-colors duration-fast hover:border-fg3 hover:bg-bg3";
  return (
    <nav aria-label="Chapters" className={cn("flex flex-wrap gap-3", className)}>
      {previous && (
        <button type="button" onClick={() => open(previous)} className={card}>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg2"><ArrowLeft size={13} strokeWidth={1.5} aria-hidden />Previous · Chapter {previous.rec.book!.chapter}</span>
          <span className="line-clamp-2 font-serif text-[17px] leading-snug text-fg">{previous.rec.title}</span>
        </button>
      )}
      {next && (
        <button type="button" onClick={() => open(next)} className={cn(card, "items-end text-right")}>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg2">Next · Chapter {next.rec.book!.chapter}<ArrowRight size={13} strokeWidth={1.5} aria-hidden /></span>
          <span className="line-clamp-2 font-serif text-[17px] leading-snug text-fg">{next.rec.title}</span>
        </button>
      )}
    </nav>
  );
}
