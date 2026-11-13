import { useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AudioLines, Check, ChevronRight, Search } from "lucide-react";
import { cn, fmtTime } from "@readaloud/ui";
import { searchable, useLibrary, type LibraryItem } from "../state/library";
import { entriesOf, finished, type Shelf } from "../state/books";
import { usePlayer } from "../state/player";
import { agoLabel } from "../lib/dates";
import { partNames } from "../lib/book";
import { openDocument } from "../lib/openDoc";
import { catalogue } from "../lib/postTitle";
import { BookMark, SourceMark } from "./SourceMark";

/** Books opened in the sidebar stay open while you read their chapters. */
const openBooks = new Set<string>();

/**
 * Every document in the library, newest first, as the sidebar's body: the app is mostly this
 * list, and choosing a document opens it beside the list. Sorting, filters and preparing audio
 * for several documents belong to the Library screen.
 */
export function SidebarLibrary() {
  const items = useLibrary((s) => s.items);
  const loaded = useLibrary((s) => s.loaded);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const playingId = usePlayer((s) => (s.doc && s.playing ? s.doc.id : null));
  const [q, setQ] = useState("");
  const [, setOpened] = useState(0);
  const current = pathname.startsWith("/read/") ? decodeURIComponent(pathname.slice("/read/".length)) : null;

  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entriesOf(needle ? items.filter((it) => searchable(it).includes(needle)) : items);
  }, [items, q]);

  // A plain press loads the document where you are; a modified one is left to the browser, so it can open a tab.
  const choose = (e: MouseEvent, it: LibraryItem) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (it.rec.id !== current) void openDocument(it.rec, navigate, { autoplay: false, resume: it.progress < 1 });
  };
  const toggle = (id: string) => {
    if (!openBooks.delete(id)) openBooks.add(id);
    setOpened((n) => n + 1);
  };

  const row = (it: LibraryItem, chapter = false) => {
    const { title, author } = catalogue(it.rec);
    const active = it.rec.id === current;
    const percent = Math.round(Math.max(0, Math.min(1, it.progress || 0)) * 100);
    const playing = it.rec.id === playingId ? <AudioLines size={13} strokeWidth={1.75} className="text-accent" role="img" aria-label="Playing" /> : null;
    const status = finished(it)
      ? <Check size={12} strokeWidth={2} className="text-accent" role="img" aria-label="Finished" />
      : percent > 0 ? <span>{percent}%</span> : null;
    return (
      <li key={it.rec.id}>
        <Link
          to={`/read/${encodeURIComponent(it.rec.id)}`}
          onClick={(e) => choose(e, it)}
          aria-current={active ? "page" : undefined}
          title={title}
          // Secondary text on the highlight takes the full foreground: the muted tone is too faint against it in some themes.
          className={cn("flex items-start gap-2.5 rounded-control py-1.5 pr-2 no-underline transition-colors duration-fast", chapter ? "pl-[42px]" : "pl-2", active ? "bg-bg3 text-fg" : "text-fg2 hover:bg-bg2")}
        >
          {!chapter && <SourceMark rec={it.rec} className="mt-0.5 size-5 rounded-md" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-5 text-fg">{chapter && it.rec.book ? `${it.rec.book.chapter}. ` : ""}{title}</span>
            {!chapter && <span className="block truncate text-[12px] leading-4">{author ?? it.rec.domain} · {fmtTime(it.duration)}</span>}
          </span>
          {chapter
            ? <span className="flex h-5 shrink-0 items-center gap-1.5 text-[11px] tabular-nums">{playing}{status}</span>
            : (
              <span className="flex shrink-0 flex-col items-end text-[11px] tabular-nums">
                <span className="flex h-5 items-center">{playing ?? agoLabel(it.rec.createdAt)}</span>
                <span className="flex h-4 items-center">{status}</span>
              </span>
            )}
        </Link>
      </li>
    );
  };

  const book = (shelf: Shelf, duration: number) => {
    const { many, One } = partNames(shelf);
    // The book that holds the open chapter shows it without being asked.
    const open = openBooks.has(shelf.id) || shelf.items.some((it) => it.rec.id === current);
    const panel = `rail-book-${shelf.id.replace(/\W/g, "-")}`;
    return (
      <li key={shelf.id}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panel : undefined}
          onClick={() => toggle(shelf.id)}
          title={shelf.title}
          className="flex w-full items-start gap-2.5 rounded-control border-0 bg-transparent py-1.5 pl-2 pr-2 text-left transition-colors duration-fast hover:bg-bg2"
        >
          <BookMark className="mt-0.5 size-5 rounded-md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-5 text-fg">{shelf.title}</span>
            <span className="block truncate text-[12px] leading-4 text-fg2">{shelf.items.length} {many} · {fmtTime(duration)}</span>
          </span>
          <ChevronRight size={14} strokeWidth={1.5} className={cn("mt-[3px] shrink-0 text-fg3 transition-transform duration-fast motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        </button>
        {open && (
          <ul id={panel} aria-label={`${One}s of ${shelf.title}`} className="m-0 flex list-none flex-col gap-px p-0">
            {shelf.items.map((it) => row(it, true))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      <label className="mx-3 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-control border border-line bg-bg2 px-2.5 text-fg2 focus-within:border-fg3">
        <Search size={14} strokeWidth={1.5} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a document" aria-label="Find a document" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-fg outline-none placeholder:text-fg3" />
      </label>
      <ul aria-label="Documents" className="m-0 flex min-h-0 flex-1 list-none flex-col gap-px overflow-y-auto px-2 pb-2">
        {entries.map((entry) => (entry.kind === "doc" ? row(entry.it) : book(entry.shelf, entry.duration)))}
        {loaded && entries.length === 0 && (
          <li className="px-2 py-3 text-[13px] leading-5 text-fg2">{items.length ? "No document matches." : "Documents you listen to appear here."}</li>
        )}
      </ul>
    </>
  );
}
