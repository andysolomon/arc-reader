import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate, useNavigationType } from "react-router-dom";
import { Search, LayoutList, LayoutGrid, Play, RotateCw, Trash2, Zap, Check, Sparkles, Tag, Star, CalendarArrowDown, ArrowDownNarrowWide, ArrowDownWideNarrow, BookOpen, ChevronRight, ListPlus, ListChecks, X } from "lucide-react";
import { Button, Chip, EmptyState, IconButton, Input, ProgressRing, VoiceServiceName, fmtTime, cn } from "@readaloud/ui";
import { voiceSource } from "../data/voices";
import { getVoice, useVoices } from "../state/voices";
import { searchable, useLibrary, type LibraryItem } from "../state/library";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { usePreparation } from "../state/preparation";
import { toast } from "../state/toast";
import { agoLabel, dateLabel } from "../lib/dates";
import { openDocument } from "../lib/openDoc";
import { FOCUS_SEARCH_EVENT } from "../hooks/useShortcuts";
import { useBreakpoint, useIsTouch } from "../hooks/useMedia";
import { audioCache } from "../lib/db";
import { syncLibrary, useLibrarySync } from "../lib/librarySync";
import { PreparationDetails, PreparationQueue, PrepareDialog, PreparedStatus, type Reading } from "../components/LibraryPreparation";
import { useCategories } from "../state/categories";
import { useJev } from "../state/llm";
import { useFavorites } from "../state/favorites";
import { usePremiumContext } from "../state/premium";
import { estimatePremium, type PremiumEstimate } from "../lib/premiumEstimate";
import { PREMIUM_FIT_LABELS, hasPremiumFit } from "../lib/premiumFit";
import { formatUsd } from "../lib/usage";
import { catalogue } from "../lib/postTitle";
import { entriesOf, finished, nextUnread, shelves, useBooks, type LibraryEntry, type Shelf } from "../state/books";
import { BookMark, SourceMark } from "../components/SourceMark";
import { partNames } from "../lib/book";

/** Category filter value for documents not yet on a shelf */
const UNCATEGORIZED = "\u0000uncategorized";

/** Books left open stay open while you go and read a chapter. */
const openBooks = new Set<string>();

/** How the Library was left, so stepping back from a document lands on the same row. */
const left = { q: "", vf: null as string | null, cf: null as string | null, favoritesOnly: false, top: 0 };

/** A click on a row is for the row (open its document, or pick it while selecting) unless it landed on one of the row's own controls or finished a text selection. */
const opensDocument = (e: MouseEvent<HTMLElement>) => !(e.target as Element).closest("button, a, input, label") && !window.getSelection()?.toString();

export function LibraryPage() {
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const touch = useIsTouch();
  const { items, loaded, refresh, remove } = useLibrary();
  const libView = useSettings((s) => s.libView);
  const libSort = useSettings((s) => s.libSort);
  const set = useSettings((s) => s.set);
  const defaultVoice = useSettings((s) => s.voice);
  const openaiModel = useSettings((s) => s.openaiModel);
  const voices = useVoices((s) => s.voices);
  const hasDoc = usePlayer((s) => !!s.doc);
  const sync = useLibrarySync();
  // Back and forward return to the Library as it was; arriving any other way starts it afresh.
  const returning = useNavigationType() === "POP";
  const [q, setQ] = useState(returning ? left.q : "");
  const [vf, setVf] = useState<string | null>(returning ? left.vf : null);
  const [cf, setCf] = useState<string | null>(returning ? left.cf : null);
  const [favoritesOnly, setFavoritesOnly] = useState(returning && left.favoritesOnly);
  const [filing, setFiling] = useState(false);
  const jevReady = useJev((s) => !!s.config?.configured);
  // Selecting is a mode: rows show no checkboxes until you ask to pick several, and it ends once they are queued.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const stopSelecting = useCallback(() => { setSelecting(false); setSelected(new Set()); }, []);
  const [prepareIds, setPrepareIds] = useState<string[] | null>(null);
  const closePrepare = useCallback(() => setPrepareIds(null), []);
  const [details, setDetails] = useState<Reading | null>(null);
  const closeDetails = useCallback(() => setDetails(null), []);
  const detailsItem = details ? items.find((it) => it.rec.id === details.docId) : undefined;
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (returning && scrollRef.current) scrollRef.current.scrollTop = left.top;
    else left.top = 0;
    // Only how the Library was entered matters.
  }, []);
  useEffect(() => { Object.assign(left, { q, vf, cf, favoritesOnly }); }, [q, vf, cf, favoritesOnly]);
  useEffect(() => {
    void refresh();
  }, [refresh, voices, openaiModel]);
  useEffect(() => { void useJev.getState().load(); }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = audioCache.subscribe(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void refresh(); }, 100);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    const on = () => searchRef.current?.focus();
    window.addEventListener(FOCUS_SEARCH_EVENT, on);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, on);
  }, []);

  useEffect(() => {
    if (!selecting || prepareIds) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") stopSelecting(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [selecting, prepareIds, stopSelecting]);

  const usedVoices = useMemo(() => Array.from(new Set(items.flatMap((i) => [i.rec.voice ?? defaultVoice, ...i.prepared.map((v) => v.voiceId)]))), [items, defaultVoice]);
  const voiceName = (id: string) => voices.find((v) => v.id === id)?.name ?? items.flatMap((i) => i.prepared).find((v) => v.voiceId === id)?.name ?? id;
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) if (it.rec.category) counts.set(it.rec.category.name, (counts.get(it.rec.category.name) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);
  const uncategorized = items.filter((it) => !it.rec.category);
  const favorites = useMemo(() => items.filter((it) => it.rec.favoritedAt), [items]);
  const premium = usePremiumContext();
  const estimates = useMemo(() => new Map(favorites.map((it) => [it.rec.id, estimatePremium(it.rec, premium.calibration, { explainable: premium.explainable })])), [favorites, premium]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (favoritesOnly && !it.rec.favoritedAt) return false;
      const v = it.rec.voice ?? defaultVoice;
      if (vf && v !== vf && !it.prepared.some((p) => p.voiceId === vf)) return false;
      if (cf && (cf === UNCATEGORIZED ? !!it.rec.category : it.rec.category?.name !== cf)) return false;
      if (!needle) return true;
      return searchable(it).includes(needle);
    });
  }, [items, q, vf, cf, favoritesOnly, defaultVoice]);
  const library = useMemo(() => shelves(items), [items]);
  const entries = useMemo(() => {
    const list = entriesOf(filtered);
    // Items arrive newest first; equal durations keep that order.
    if (libSort === "created") return list;
    const length = (entry: LibraryEntry) => entry.kind === "doc" ? entry.it.duration : entry.duration;
    return list.sort((a, b) => libSort === "shortest" ? length(a) - length(b) : length(b) - length(a));
  }, [filtered, libSort]);
  const [, setOpened] = useState(0);
  const toggleBook = (id: string) => {
    if (!openBooks.delete(id)) openBooks.add(id);
    setOpened((n) => n + 1);
  };
  const fileUncategorized = async () => {
    setFiling(true);
    try {
      const filed = await useCategories.getState().suggestAll(uncategorized.map((it) => it.rec));
      const missed = uncategorized.length - filed;
      toast(missed ? `Jev filed ${filed} of ${uncategorized.length}. Open a document's details to retry.` : `Jev filed ${filed} ${filed === 1 ? "document" : "documents"}`);
    } finally {
      setFiling(false);
    }
  };

  const grid = bp === "md" || libView === "grid";
  const selectedItems = items.filter((it) => selected.has(it.rec.id));
  const allVisibleSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.rec.id));
  const toggleSelected = (id: string) => {
    setSelecting(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleVisible = () => setSelected((prev) => {
    const next = new Set(prev);
    for (const it of filtered) { if (allVisibleSelected) next.delete(it.rec.id); else next.add(it.rec.id); }
    return next;
  });

  const act = {
    open: (it: LibraryItem) => void openDocument(it.rec, navigate, { autoplay: false, resume: it.progress < 1 }),
    resume: (it: LibraryItem) => void openDocument(it.rec, navigate, { autoplay: true, resume: it.progress < 1 }),
    revoice: (it: LibraryItem) => navigate(`/voices?for=${it.rec.id}`),
    prepare: (it: LibraryItem) => setPrepareIds([it.rec.id]),
    details: setDetails,
    favorite: (it: LibraryItem) => {
      void useFavorites.getState().toggle(it.rec);
      toast(it.rec.favoritedAt ? "Removed from favorites" : "Added to favorites · estimating a premium read");
    },
    toggleSelected,
    del: async (it: LibraryItem) => {
      if (usePlayer.getState().doc?.id === it.rec.id) usePlayer.getState().close();
      await remove(it.rec.id);
      toast("Removed from library");
    },
  };

  const bookProps = (shelf: Shelf) => {
    const whole = library.get(shelf.id) ?? shelf;
    const source = whole.items.find((it) => it.rec.book?.contents) ?? whole.items.find((it) => it.rec.meta?.url);
    return {
      shelf, whole, grid, open: openBooks.has(shelf.id),
      onToggle: () => toggleBook(shelf.id),
      onContinue: () => act.resume(nextUnread(whole)),
      onPrepare: () => setPrepareIds(whole.items.map((it) => it.rec.id)),
      onComplete: source ? () => void useBooks.getState().complete(source.rec) : undefined,
    };
  };

  return (
    <section ref={scrollRef} onScroll={(e) => { left.top = e.currentTarget.scrollTop; }} data-screen="library" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: hasDoc ? 160 : 64 }}>
      <div className="mx-auto flex max-w-[880px] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 flex-1 font-serif text-[26px] font-medium">Library</h1>
          <Input ref={searchRef} leading={<Search size={16} strokeWidth={1.5} aria-hidden />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search  /" aria-label="Search library" wrapperClassName="w-full sm:w-[240px]" />
          <div className="flex overflow-hidden rounded-control border border-line bg-bg2" role="group" aria-label="Sort">
            <IconButton label="Newest first" active={libSort === "created"} onClick={() => set("libSort", "created")} className="rounded-none">
              <CalendarArrowDown size={16} strokeWidth={1.5} />
            </IconButton>
            {/* Duration flips between shortest and longest first on each press. */}
            <IconButton label={libSort === "longest" ? "Longest first" : "Shortest first"} active={libSort !== "created"} onClick={() => set("libSort", libSort === "shortest" ? "longest" : "shortest")} className="rounded-none">
              {libSort === "longest" ? <ArrowDownWideNarrow size={16} strokeWidth={1.5} /> : <ArrowDownNarrowWide size={16} strokeWidth={1.5} />}
            </IconButton>
          </div>
          {bp !== "md" && (
            <div className="flex overflow-hidden rounded-control border border-line bg-bg2" role="group" aria-label="View">
              <IconButton label="List" active={!grid} onClick={() => set("libView", "list")} className="rounded-none">
                <LayoutList size={16} strokeWidth={1.5} />
              </IconButton>
              <IconButton label="Cards" active={grid} onClick={() => set("libView", "grid")} className="rounded-none">
                <LayoutGrid size={16} strokeWidth={1.5} />
              </IconButton>
            </div>
          )}
          {items.length > 0 && (
            <Button aria-pressed={selecting} leading={<ListChecks size={16} strokeWidth={1.5} />} className={cn("h-[38px]", selecting && "!bg-bg3")} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              Select
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[13px] text-fg2" role="status" aria-label="Library sync">
          <span>{sync.status === "synced" ? "Shared library · Synced" : sync.status === "syncing" ? "Shared library · Syncing…" : sync.pending ? "Saved on this device · Waiting to sync" : "Server unavailable · Showing saved library"}</span>
          {sync.status === "synced" && <span aria-label="Synced document count">· {sync.documents} {sync.documents === 1 ? "document" : "documents"}</span>}
          <button type="button" disabled={sync.status === "syncing"} className="ml-1.5 text-accent hover:text-fg disabled:opacity-50" onClick={() => { void syncLibrary().then(() => usePreparation.getState().refreshShared()).then(() => refresh()); }}>{sync.status === "offline" ? "Retry sync" : "Sync now"}</button>
          {sync.status === "offline" && sync.error && <span className="basis-full">{sync.error}</span>}
        </div>
        {favorites.length > 0 && (
          <FavoritesBar count={favorites.length} selected={favoritesOnly} onSelect={setFavoritesOnly} estimates={[...estimates.values()]} />
        )}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by voice">
            <Chip size="sm" selected={vf === null} onClick={() => setVf(null)}>
              All voices
            </Chip>
            {usedVoices.map((id) => (
              <Chip key={id} size="sm" selected={vf === id} onClick={() => setVf(id)}>
                <VoiceServiceName source={voiceSource(items.flatMap((it) => it.prepared).find((v) => v.voiceId === id) ?? getVoice(id))} inherit={vf === id}>{voiceName(id)}</VoiceServiceName>
              </Chip>
            ))}
          </div>
        )}
        {(categories.length > 0 || (jevReady && uncategorized.length > 0)) && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
            {categories.length > 0 && (
              <>
                <Chip size="sm" selected={cf === null} onClick={() => setCf(null)}>All categories</Chip>
                {categories.map(([name, count]) => (
                  <Chip key={name} size="sm" selected={cf === name} onClick={() => setCf(name)}>{name} <span className="tabular-nums opacity-70">{count}</span></Chip>
                ))}
                {uncategorized.length > 0 && (
                  <Chip size="sm" selected={cf === UNCATEGORIZED} onClick={() => setCf(UNCATEGORIZED)}>Uncategorized <span className="tabular-nums opacity-70">{uncategorized.length}</span></Chip>
                )}
              </>
            )}
            {jevReady && uncategorized.length > 0 && (
              <Button variant="ghost" leading={<Sparkles size={14} strokeWidth={1.5} />} loading={filing} onClick={() => void fileUncategorized()}>
                File {uncategorized.length} uncategorized with Jev
              </Button>
            )}
          </div>
        )}
        {selecting && (
          <div role="toolbar" aria-label="Selection" className="sticky top-2 z-20 -mx-2 flex flex-wrap items-center gap-1.5 rounded-panel border border-line bg-bg2 py-1.5 pl-1.5 pr-2 shadow-overlay">
            <IconButton label="Done selecting" onClick={stopSelecting}>
              <X size={18} strokeWidth={1.5} />
            </IconButton>
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg" role="status">{selectedItems.length > 0 ? `${selectedItems.length} selected` : "Choose documents to prepare together"}</span>
            <Button variant="ghost" aria-pressed={allVisibleSelected} disabled={filtered.length === 0} onClick={toggleVisible}>Select {q || vf || cf || favoritesOnly ? "visible" : "all"}</Button>
            <Button variant="primary" leading={<Zap size={15} />} disabled={selectedItems.length === 0} onClick={() => setPrepareIds(selectedItems.map((it) => it.rec.id))}>Prepare selected</Button>
          </div>
        )}
        <PreparationQueue onDetails={setDetails} />
        {loaded && items.length === 0 && (
          <EmptyState action={<Link to="/compose">Paste something to listen to</Link>}>Nothing here yet. Documents you listen to appear here with your place saved.</EmptyState>
        )}
        {items.length > 0 && filtered.length === 0 && (
          <EmptyState
            action={
              <button type="button" onClick={() => { setQ(""); setVf(null); setCf(null); setFavoritesOnly(false); }} className="border-0 bg-transparent p-0 text-accent hover:text-fg">
                Clear filters
              </button>
            }
          >
            Nothing here matches.
          </EmptyState>
        )}
        {filtered.length > 0 && !grid && (
          <ul className="m-0 -mx-5 flex list-none flex-col border-t border-line p-0 sm:-mx-4">
            {entries.map((entry) => entry.kind === "doc" ? (
              <Row key={entry.it.rec.id} it={entry.it} touch={touch} defaultVoice={defaultVoice} selecting={selecting} selected={selected.has(entry.it.rec.id)} estimate={estimates.get(entry.it.rec.id)} {...act} />
            ) : (
              <BookGroup key={entry.shelf.id} {...bookProps(entry.shelf)}>
                {entry.shelf.items.map((it) => (
                  <Row key={it.rec.id} it={it} inBook touch={touch} defaultVoice={defaultVoice} selecting={selecting} selected={selected.has(it.rec.id)} estimate={estimates.get(it.rec.id)} {...act} />
                ))}
              </BookGroup>
            ))}
          </ul>
        )}
        {filtered.length > 0 && grid && (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5 p-0">
            {entries.map((entry) => entry.kind === "doc" ? (
              <CardItem key={entry.it.rec.id} it={entry.it} defaultVoice={defaultVoice} selecting={selecting} selected={selected.has(entry.it.rec.id)} estimate={estimates.get(entry.it.rec.id)} {...act} />
            ) : (
              <BookGroup key={entry.shelf.id} {...bookProps(entry.shelf)}>
                {entry.shelf.items.map((it) => (
                  <CardItem key={it.rec.id} it={it} inBook defaultVoice={defaultVoice} selecting={selecting} selected={selected.has(it.rec.id)} estimate={estimates.get(it.rec.id)} {...act} />
                ))}
              </BookGroup>
            ))}
          </ul>
        )}
      </div>
      {detailsItem && details && !prepareIds && <PreparationDetails it={detailsItem} reading={details} defaultVoice={defaultVoice} onClose={closeDetails} onChooseVoices={() => { setDetails(null); setPrepareIds([details.docId]); }} />}
      {prepareIds && <PrepareDialog documents={items.filter((it) => prepareIds.includes(it.rec.id))} onClose={closePrepare} onQueued={stopSelecting} />}
    </section>
  );
}

interface ItemProps {
  it: LibraryItem;
  /** Listed under its book, which already names the book and orders the chapters */
  inBook?: boolean;
  defaultVoice: string;
  /** Picking several documents: a press picks one instead of opening it */
  selecting: boolean;
  selected: boolean;
  /** Premium read estimate, for favorites */
  estimate?: PremiumEstimate;
  toggleSelected: (id: string) => void;
  prepare: (it: LibraryItem) => void;
  /** Show what one voice has prepared for a document. */
  details: (reading: Reading) => void;
  favorite: (it: LibraryItem) => void;
  /** Open in the Reader without starting playback. */
  open: (it: LibraryItem) => void;
  resume: (it: LibraryItem) => void;
  revoice: (it: LibraryItem) => void;
  del: (it: LibraryItem) => void;
}

/** Open a document, or pick it while selecting. Ctrl or ⌘ starts a selection from an ordinary click. */
function activate(e: MouseEvent<HTMLElement>, { it, selecting, toggleSelected, open }: ItemProps) {
  if (selecting || e.metaKey || e.ctrlKey) toggleSelected(it.rec.id);
  else open(it);
}

const TITLE = "line-clamp-2 border-0 bg-transparent p-0 text-left text-[16px] font-medium leading-[22px] text-fg sm:text-[15px]";
const PICKED = "!bg-[color-mix(in_oklch,var(--accent)_8%,var(--bg))]";

function Actions({ it, resume, revoice, prepare, favorite, del, size = 36, className }: ItemProps & { size?: 32 | 36 | 44; className?: string }) {
  const starred = !!it.rec.favoritedAt;
  return (
    <div className={cn("flex gap-0.5", className)}>
      <IconButton label="Favorite" size={size} active={starred} onClick={() => favorite(it)}>
        <Star size={size === 32 ? 16 : 20} strokeWidth={1.5} fill={starred ? "currentColor" : "none"} className={starred ? "text-accent" : undefined} />
      </IconButton>
      <IconButton label={it.progress > 0 && it.progress < 1 ? "Resume" : "Play"} size={size} onClick={() => resume(it)}>
        <Play size={size === 32 ? 16 : 20} strokeWidth={1.5} />
      </IconButton>
      <IconButton label="Prepare audio" size={size} onClick={() => prepare(it)}>
        <Zap size={size === 32 ? 16 : 20} strokeWidth={1.5} />
      </IconButton>
      <IconButton label="Re-voice" size={size} onClick={() => revoice(it)}>
        <RotateCw size={size === 32 ? 16 : 20} strokeWidth={1.5} />
      </IconButton>
      <IconButton label="Delete" size={size} onClick={() => del(it)} className="hover:!text-danger">
        <Trash2 size={size === 32 ? 16 : 20} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

/** What leads a row: where the document came from, or while selecting, whether it is picked. */
function Lead({ it, inBook, selecting, selected, className }: Pick<ItemProps, "it" | "inBook" | "selecting" | "selected"> & { className?: string }) {
  if (selecting) {
    return (
      <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center", className)}>
        <span className={cn("grid size-[22px] place-items-center rounded-full border-[1.5px] transition-colors duration-fast", selected ? "border-accent bg-accent text-accent-fg" : "border-fg3")}>
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      </span>
    );
  }
  // A chapter sits under its book's mark.
  if (inBook) return <span aria-hidden className={cn("size-6 shrink-0", className)} />;
  return <SourceMark rec={it.rec} className={className} />;
}

/**
 * Facts about a document, shortest first so a narrow row breaks before the long ones.
 * Each separator belongs to the fact after it and the one starting a line is clipped,
 * so a wrap never strands a dot. The reading voice is in the prepared-audio chips.
 */
function Meta({ it, inBook, card, estimate, className }: { it: LibraryItem; inBook?: boolean; /** A card has no trailing edge, so its facts carry the date and readings too */ card?: boolean; estimate?: PremiumEstimate; className?: string }) {
  const { author } = catalogue(it.rec);
  return (
    <div className={cn("min-w-0 overflow-hidden text-[13px] leading-5 text-fg2", className)}>
      <div className="-ml-4 flex flex-wrap items-center gap-y-0.5">
        {author && <Fact title="Author"><span className="truncate">{author}</span></Fact>}
        <Fact><span className="truncate">{it.rec.domain}</span></Fact>
        <Fact className="tabular-nums">{fmtTime(it.duration)}</Fact>
        {it.rec.book && !inBook && (
          <Fact title={`${partNames(it.rec.book).One} ${it.rec.book.chapter} of ${it.rec.book.title}`}>
            <BookOpen size={12} strokeWidth={1.5} className="shrink-0 text-fg3" aria-hidden />
            <span className="truncate">{partNames(it.rec.book).short} {it.rec.book.chapter} · {it.rec.book.title}</span>
          </Fact>
        )}
        {card && <Fact title={`Added ${dateLabel(it.rec.createdAt)}`} className="tabular-nums">{agoLabel(it.rec.createdAt)}</Fact>}
        {card && it.reads > 0 && <Fact><ReadBadge reads={it.reads} /></Fact>}
        {it.rec.category && (
          <Fact title={it.rec.category.by === "jev" ? "Filed by Jev" : "Category"}>
            <Tag size={12} strokeWidth={1.5} className="shrink-0 text-fg3" aria-hidden />
            <span className="truncate">{it.rec.category.name}</span>
          </Fact>
        )}
        {it.rec.favoritedAt && <Fact><PremiumBadge it={it} estimate={estimate} /></Fact>}
      </div>
    </div>
  );
}

/** A chapter listed under its book leads with its number. */
const rowTitle = ({ it, inBook }: Pick<ItemProps, "it" | "inBook">) => `${inBook && it.rec.book ? `${it.rec.book.chapter}. ` : ""}${catalogue(it.rec).title}`;

/**
 * A book's chapters behind one row: how far through the book you are, with the chapters
 * a press away. Continue picks up at the first chapter you haven't finished.
 */
function BookGroup({ shelf, whole, grid, open, onToggle, onContinue, onPrepare, onComplete, children }: {
  /** The chapters that pass the current filters */
  shelf: Shelf;
  /** Every chapter in the library */
  whole: Shelf;
  grid: boolean;
  open: boolean;
  onToggle: () => void;
  onContinue: () => void;
  onPrepare: () => void;
  /** Fetch the chapters the library is missing */
  onComplete?: () => void;
  children: ReactNode;
}) {
  const adding = useBooks((s) => s.adding[shelf.id]);
  const total = whole.items.reduce((sum, it) => sum + it.duration, 0);
  const heard = whole.items.reduce((sum, it) => sum + it.duration * (finished(it) ? 1 : it.progress), 0);
  const read = whole.items.filter(finished).length;
  const have = new Set(whole.items.map((it) => it.rec.book!.chapter)).size;
  const missing = whole.chapters - have;
  const { one, many, One } = partNames(whole);
  // A course posts lectures as it runs, so its page is worth asking again even when nothing is missing.
  const growing = whole.kind === "course" && !!whole.contents;
  const started = heard > 0;
  const panel = `book-${shelf.id.replace(/\W/g, "-")}`;
  return (
    <li data-book={shelf.title} className={cn(grid ? "col-span-full overflow-hidden rounded-card border border-line bg-bg2" : "border-b border-line")}>
      <div
        onClick={(e) => { if (opensDocument(e)) onToggle(); }}
        className={cn("grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 transition-colors duration-fast", grid ? "p-4" : "px-5 py-3.5 active:bg-bg2 sm:px-4 [@media(hover:hover)]:hover:bg-bg2")}
      >
        <BookMark />
        <div className={cn(TITLE, "min-w-0")}>{shelf.title}</div>
        <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined} aria-label={`${open ? "Hide" : "Show"} ${many} of ${shelf.title}`} onClick={onToggle} className="-mr-1 grid size-[22px] shrink-0 place-items-center rounded-control border-0 bg-transparent text-fg3 hover:text-fg">
          <ChevronRight size={16} strokeWidth={1.5} className={cn("transition-transform duration-fast motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        </button>
        <div className="col-span-2 col-start-2 mt-0.5 min-w-0 overflow-hidden text-[13px] leading-5 text-fg2">
          <div className="-ml-4 flex flex-wrap items-center gap-y-0.5">
            <Fact>{whole.kind === "course" ? "Course" : "Book"}</Fact>
            <Fact className="tabular-nums">{missing > 0 ? `${have} of ${whole.chapters} ${many}` : `${have} ${many}`}</Fact>
            <Fact className="tabular-nums">{fmtTime(total)}</Fact>
            {read > 0 && <Fact className="tabular-nums text-accent">{read === have ? "All read" : `${read} read`}</Fact>}
            {shelf.items.length < whole.items.length && <Fact className="tabular-nums">{shelf.items.length} shown</Fact>}
          </div>
        </div>
        <div className="col-span-2 col-start-2 mt-1 flex items-start justify-between gap-3">
          <div className="-ml-2 flex flex-wrap items-center gap-x-1 text-[13px] text-fg2">
            <Button variant="ghost" className="px-2" aria-label={`${started ? "Continue" : "Start"} ${shelf.title}`} leading={<Play size={15} strokeWidth={1.5} />} onClick={onContinue}>{started ? "Continue" : "Start"}</Button>
            <Button variant="ghost" className="px-2" aria-label={`Prepare audio for ${shelf.title}`} leading={<Zap size={15} strokeWidth={1.5} />} onClick={onPrepare}>Prepare</Button>
            {adding
              ? <span role="status" className="px-2 tabular-nums">{adding.total ? `Adding ${many} · ${adding.done} of ${adding.total}` : `Checking for new ${many}…`}</span>
              : (missing > 0 || growing) && onComplete && <Button variant="ghost" className="px-2" leading={<ListPlus size={15} strokeWidth={1.5} />} onClick={onComplete}>{missing <= 0 ? `Check for new ${many}` : missing === 1 ? `Add the missing ${one}` : `Add the ${missing} missing ${many}`}</Button>}
          </div>
          <Progress value={total ? heard / total : 0} className="h-[34px]" />
        </div>
      </div>
      {open && (
        <ul id={panel} aria-label={`${One}s of ${shelf.title}`} className={cn("m-0 list-none border-t border-line p-0", grid ? "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5 bg-bg p-4" : "flex flex-col [&>li:last-child]:border-b-0")}>
          {children}
        </ul>
      )}
    </li>
  );
}

function Fact({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("relative inline-flex min-w-0 max-w-full items-center gap-1.5 pl-4", className)}>
      <span aria-hidden className="absolute left-0 w-4 text-center text-fg3">·</span>
      {children}
    </span>
  );
}

const costRange = (low: number, high: number) => formatUsd(low) === formatUsd(high) ? formatUsd(low) : `${formatUsd(low)}–${formatUsd(high)}`;

/** A favorite's premium read: what it would cost across paid voices, and Jev's verdict. */
function PremiumBadge({ it, estimate }: { it: LibraryItem; estimate?: PremiumEstimate }) {
  const assessing = useFavorites((s) => !!s.assessing[it.rec.id]);
  const costs = estimate?.options.map((o) => o.costUsd) ?? [];
  const fit = hasPremiumFit(it.rec) ? it.rec.premium! : null;
  const detail = estimate?.options.map((o) => `${o.label}: ≈${formatUsd(o.costUsd)}`).join("\n");
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-fg2" title={detail ? `Premium read, whole document once\n${detail}` : undefined}>
      <Star size={12} strokeWidth={1.5} fill="currentColor" className="shrink-0 text-accent" aria-hidden />
      {costs.length > 0 && <span className="tabular-nums" aria-label={`Premium read about ${costRange(Math.min(...costs), Math.max(...costs))}`}>Premium ≈{costRange(Math.min(...costs), Math.max(...costs))}</span>}
      {fit ? <span className={fit.fit === "strong" ? "text-accent" : undefined}>· {PREMIUM_FIT_LABELS[fit.fit]}</span> : assessing ? <span>· Assessing…</span> : null}
    </span>
  );
}

/** Favorites filter, with what a premium read of every favorite would cost per paid voice. */
function FavoritesBar({ count, selected, onSelect, estimates }: { count: number; selected: boolean; onSelect: (on: boolean) => void; estimates: PremiumEstimate[] }) {
  const totals = new Map<string, { label: string; cost: number }>();
  for (const estimate of estimates) {
    for (const option of estimate.options) {
      const total = totals.get(option.id) ?? { label: option.label, cost: 0 };
      total.cost += option.costUsd;
      totals.set(option.id, total);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex gap-1.5" role="group" aria-label="Filter by favorites">
        <Chip size="sm" selected={!selected} onClick={() => onSelect(false)}>All documents</Chip>
        <Chip size="sm" selected={selected} onClick={() => onSelect(true)}>
          <Star size={12} strokeWidth={1.5} fill="currentColor" aria-hidden /> Favorites <span className="tabular-nums opacity-70">{count}</span>
        </Chip>
      </div>
      {totals.size > 0 && (
        <span className="text-[12px] text-fg2" aria-label="Premium read estimate for all favorites">
          Premium read of {count === 1 ? "your favorite" : `all ${count} favorites`}: {[...totals.values()].map((t) => `${t.label} ≈${formatUsd(t.cost)}`).join(" · ")}
        </span>
      )}
    </div>
  );
}

/** Finished readings stay on record while the ring tracks the current pass. */
function ReadBadge({ reads }: { reads: number }) {
  const label = reads === 1 ? "Read once" : `Read ${reads} times`;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-accent" aria-label={label} title={label}>
      <Check size={12} strokeWidth={2} aria-hidden />
      {reads === 1 ? "Read" : `Read ${reads}×`}
    </span>
  );
}

const percentOf = (value: number) => Math.round(Math.max(0, Math.min(1, value || 0)) * 100);

/** Listening progress for a card: a ring with the percentage inside, or a check once finished. */
function ReadProgress({ value, className }: { value: number; className?: string }) {
  const percent = percentOf(value);
  return (
    <div className={cn("relative grid size-9 shrink-0 place-items-center", className)}>
      <ProgressRing value={value} size={36} />
      <span aria-hidden className="absolute inset-0 grid place-items-center text-[10px] font-medium tabular-nums text-fg2">
        {percent >= 100 ? <Check size={14} strokeWidth={2} className="text-accent" /> : `${percent}%`}
      </span>
    </div>
  );
}

/** Listening progress on a row's trailing edge: past readings, the percentage once begun, and a small ring. */
function Progress({ value, reads = 0, className }: { value: number; reads?: number; className?: string }) {
  const percent = percentOf(value);
  return (
    <span className={cn("flex h-7 shrink-0 items-center gap-1.5 text-[12px] text-fg2", className)}>
      {reads > 0 && <ReadBadge reads={reads} />}
      {percent > 0 && percent < 100 && <span aria-hidden className="tabular-nums">{percent}%</span>}
      {percent >= 100 && reads === 0 && <Check size={13} strokeWidth={2} className="text-accent" aria-hidden />}
      <ProgressRing value={value} size={22} stroke={2} />
    </span>
  );
}

/** Five 44px actions, their gaps and the panel's padding. */
const SWIPE_W = 5 * 44 + 4 * 2 + 16;

/**
 * List row, edge to edge: a press anywhere opens the document. Hover reveals its actions
 * over the trailing edge; on touch, swipe left reveals them.
 */
function Row(props: ItemProps & { touch: boolean }) {
  const { it, touch, selecting, selected, inBook } = props;
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  /** The press now ending was a swipe, so it must not also open the document */
  const swiped = useRef(false);

  const onDown = (e: PointerEvent<HTMLLIElement>) => {
    swiped.current = false;
    if (!touch || e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e: PointerEvent<HTMLLIElement>) => {
    if (!start.current || e.pointerId !== start.current.id) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (Math.abs(ddy) > Math.abs(ddx)) return;
    if (Math.abs(ddx) > 8) swiped.current = true;
    setDx(Math.max(-SWIPE_W, Math.min(0, (open ? -SWIPE_W : 0) + ddx)));
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    const o = dx < -SWIPE_W / 2;
    setOpen(o);
    setDx(o ? -SWIPE_W : 0);
  };
  const offset = touch ? dx : 0;
  const press = (e: MouseEvent<HTMLElement>) => {
    // The click that ends a swipe only reveals the actions.
    if (swiped.current) { swiped.current = false; return; }
    // With its actions swiped into view, a press on the row puts them away.
    if (touch && open) { setOpen(false); setDx(0); return; }
    activate(e, props);
  };

  return (
    <li
      className="group relative touch-pan-y overflow-hidden border-b border-line"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      data-swipe-open={open || undefined}
    >
      {touch && (
        <div className="absolute inset-y-0 right-0 flex items-center bg-bg3 px-2" style={{ width: SWIPE_W }} aria-hidden={!open}>
          <Actions {...props} size={44} />
        </div>
      )}
      <div
        onClick={(e) => { if (opensDocument(e)) press(e); }}
        className={cn(
          "relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 bg-bg px-5 py-3.5 transition-[background-color,transform] duration-fast active:bg-bg2 sm:px-4 [@media(hover:hover)]:group-hover:bg-bg2",
          selected && PICKED,
        )}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transitionProperty: start.current ? "background-color" : undefined }}
      >
        <Lead {...props} />
        <div className="min-w-0">
          <button type="button" aria-pressed={selecting ? selected : undefined} onClick={press} className={cn(TITLE, inBook && "font-normal")}>
            {rowTitle(props)}
          </button>
        </div>
        <time dateTime={Number.isFinite(it.rec.createdAt) ? new Date(it.rec.createdAt).toISOString() : undefined} title={`Added ${dateLabel(it.rec.createdAt)}`} className="shrink-0 text-[12px] leading-[22px] tabular-nums text-fg2">
          {agoLabel(it.rec.createdAt)}
        </time>
        <Meta it={it} inBook={inBook} estimate={props.estimate} className="col-span-2 col-start-2 mt-0.5" />
        <div className="col-span-2 col-start-2 mt-2 flex items-start justify-between gap-3">
          <PreparedStatus it={it} defaultVoice={props.defaultVoice} onDetails={props.details} />
          <Progress value={it.progress} reads={it.reads} />
        </div>
        {!touch && !selecting && (
          <Actions {...props} size={32} className="absolute right-2 top-2 rounded-control bg-bg2 opacity-0 shadow-[-12px_0_10px_var(--bg2)] transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 sm:right-2.5" />
        )}
      </div>
    </li>
  );
}

function CardItem(props: ItemProps) {
  const { it, selecting, selected } = props;
  return (
    <li
      onClick={(e) => { if (opensDocument(e)) activate(e, props); }}
      className={cn("group flex min-h-[170px] cursor-pointer flex-col gap-3 rounded-card border border-line bg-bg2 p-4 transition-colors duration-fast hover:border-fg3", selected && "!border-accent")}
    >
      <div className="flex h-9 items-center justify-between gap-2">
        <div className="flex items-center gap-2.5"><Lead {...props} inBook={false} /><ReadProgress value={it.progress} /></div>
        {!selecting && <Actions {...props} size={32} className="-mr-1.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100" />}
      </div>
      <div className="flex-1">
        <button type="button" aria-pressed={selecting ? selected : undefined} onClick={(e) => activate(e, props)} className={cn(TITLE, "line-clamp-3 sm:text-[16px]")}>
          {rowTitle(props)}
        </button>
        <Meta it={it} inBook={props.inBook} estimate={props.estimate} card className="mt-1" />
      </div>
      <div className="border-t border-line pt-3">
        <PreparedStatus it={it} defaultVoice={props.defaultVoice} onDetails={props.details} />
      </div>
    </li>
  );
}
