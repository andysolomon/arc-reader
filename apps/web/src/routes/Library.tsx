import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, LayoutList, LayoutGrid, Play, RotateCw, Trash2, Zap, Globe, FileText, ClipboardList, Check, Sparkles, Tag, Star, CalendarArrowDown, ArrowDownNarrowWide, ArrowDownWideNarrow } from "lucide-react";
import { Button, Chip, EmptyState, IconButton, Input, ProgressRing, VoiceServiceName, fmtTime, cn } from "@readaloud/ui";
import { voiceSource } from "../data/voices";
import { getVoice, useVoices } from "../state/voices";
import { useLibrary, type LibraryItem } from "../state/library";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { usePreparation } from "../state/preparation";
import { toast } from "../state/toast";
import { dateLabel } from "../lib/dates";
import { openDocument } from "../lib/openDoc";
import { FOCUS_SEARCH_EVENT } from "../hooks/useShortcuts";
import { useBreakpoint, useIsTouch } from "../hooks/useMedia";
import { audioCache } from "../lib/db";
import { syncLibrary, useLibrarySync } from "../lib/librarySync";
import { PreparationQueue, PrepareDialog, PreparedStatus } from "../components/LibraryPreparation";
import { useCategories } from "../state/categories";
import { useJev } from "../state/llm";
import { useFavorites } from "../state/favorites";
import { usePremiumContext } from "../state/premium";
import { estimatePremium, type PremiumEstimate } from "../lib/premiumEstimate";
import { PREMIUM_FIT_LABELS, hasPremiumFit } from "../lib/premiumFit";
import { formatUsd } from "../lib/usage";

/** Category filter value for documents not yet on a shelf */
const UNCATEGORIZED = "\u0000uncategorized";

/** Everything a researcher might remember a document by. */
const searchable = ({ rec }: LibraryItem) => [rec.title, rec.domain, rec.category?.name, ...Object.values(rec.meta ?? {})].join("\n").toLowerCase();

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
  const [q, setQ] = useState("");
  const [vf, setVf] = useState<string | null>(null);
  const [cf, setCf] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filing, setFiling] = useState(false);
  const jevReady = useJev((s) => !!s.config?.configured);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prepareIds, setPrepareIds] = useState<string[] | null>(null);
  const closePrepare = useCallback(() => setPrepareIds(null), []);
  const searchRef = useRef<HTMLInputElement>(null);

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
  // Items arrive newest first; equal durations keep that order.
  const sorted = useMemo(() => libSort === "created" ? filtered : [...filtered].sort((a, b) => libSort === "shortest" ? a.duration - b.duration : b.duration - a.duration), [filtered, libSort]);
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
  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const act = {
    open: (it: LibraryItem) => void openDocument(it.rec, navigate, { autoplay: false, resume: it.progress < 1 }),
    resume: (it: LibraryItem) => void openDocument(it.rec, navigate, { autoplay: true, resume: it.progress < 1 }),
    revoice: (it: LibraryItem) => navigate(`/voices?for=${it.rec.id}`),
    prepare: (it: LibraryItem) => setPrepareIds([it.rec.id]),
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

  return (
    <section data-screen="library" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: hasDoc ? 160 : 64 }}>
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
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg2">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={allVisibleSelected} disabled={filtered.length === 0} onChange={() => setSelected((prev) => {
                const next = new Set(prev);
                for (const it of filtered) { if (allVisibleSelected) next.delete(it.rec.id); else next.add(it.rec.id); }
                return next;
              })} />
              Select {q || vf || cf || favoritesOnly ? "visible" : "all"}
            </label>
            <span className="flex-1 text-[13px] text-fg2">{selectedItems.length > 0 ? `${selectedItems.length} selected` : "Select documents to prepare together"}</span>
            {selectedItems.length > 0 && <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>}
            <Button leading={<Zap size={15} />} disabled={selectedItems.length === 0} onClick={() => setPrepareIds(selectedItems.map((it) => it.rec.id))}>Prepare selected</Button>
          </div>
        )}
        <PreparationQueue />
        {loaded && items.length === 0 && (
          <EmptyState action={<Link to="/">Paste something to listen to</Link>}>Nothing here yet. Documents you listen to appear here with your place saved.</EmptyState>
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
          <ul className="-mx-5 m-0 flex list-none flex-col overflow-hidden border-y border-line bg-bg2 p-0 sm:mx-0 sm:rounded-card sm:border-x">
            {sorted.map((it) => (
              <Row key={it.rec.id} it={it} touch={touch} defaultVoice={defaultVoice} selected={selected.has(it.rec.id)} estimate={estimates.get(it.rec.id)} {...act} />
            ))}
          </ul>
        )}
        {filtered.length > 0 && grid && (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5 p-0">
            {sorted.map((it) => (
              <CardItem key={it.rec.id} it={it} defaultVoice={defaultVoice} selected={selected.has(it.rec.id)} estimate={estimates.get(it.rec.id)} {...act} />
            ))}
          </ul>
        )}
      </div>
      {prepareIds && <PrepareDialog documents={items.filter((it) => prepareIds.includes(it.rec.id))} onClose={closePrepare} />}
    </section>
  );
}

interface ItemProps {
  it: LibraryItem;
  defaultVoice: string;
  selected: boolean;
  /** Premium read estimate, for favorites */
  estimate?: PremiumEstimate;
  toggleSelected: (id: string) => void;
  prepare: (it: LibraryItem) => void;
  favorite: (it: LibraryItem) => void;
  /** Open in the Reader without starting playback. */
  open: (it: LibraryItem) => void;
  resume: (it: LibraryItem) => void;
  revoice: (it: LibraryItem) => void;
  del: (it: LibraryItem) => void;
}

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

/**
 * Facts about a document, shortest first so a narrow row breaks before the long ones.
 * Each separator belongs to the fact after it and the one starting a line is clipped,
 * so a wrap never strands a dot. The reading voice is in the prepared-audio chips.
 */
function Meta({ it, withDate, estimate, className }: { it: LibraryItem; withDate?: boolean; estimate?: PremiumEstimate; className?: string }) {
  return (
    <div className={cn("min-w-0 overflow-hidden text-[12px] leading-[18px] text-fg2", className)}>
      <div className="-ml-4 flex flex-wrap items-center gap-y-0.5">
        <Fact>
          <SourceIcon rec={it.rec} />
          <span className="truncate">{it.rec.domain}</span>
        </Fact>
        <Fact className="tabular-nums">{fmtTime(it.duration)}</Fact>
        {withDate && <Fact title="Added">{dateLabel(it.rec.createdAt)}</Fact>}
        {it.reads > 0 && <Fact><ReadBadge reads={it.reads} /></Fact>}
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

/** Listening progress: a ring with the percentage inside, or a check once finished. */
function ReadProgress({ value, size = 40, className }: { value: number; size?: 36 | 40; className?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <ProgressRing value={value} size={size} />
      <span aria-hidden className="absolute inset-0 grid place-items-center text-[10px] font-medium tabular-nums text-fg2">
        {percent >= 100 ? <Check size={14} strokeWidth={2} className="text-accent" /> : `${percent}%`}
      </span>
    </div>
  );
}

/** Site favicon for articles, via the server so the browser never reports library sites elsewhere. */
function SourceIcon({ rec }: { rec: LibraryItem["rec"] }) {
  const [failed, setFailed] = useState(false);
  const site = (rec.source === "url" || rec.source === "share") && rec.domain.includes(".") && !/[\s/]/.test(rec.domain);
  if (site && !failed) {
    return <img src={`/api/favicon?host=${encodeURIComponent(rec.domain)}`} alt="" width={14} height={14} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-3.5 shrink-0 rounded-[3px]" />;
  }
  const Icon = site ? Globe : rec.source === "file" ? FileText : ClipboardList;
  return <Icon size={14} strokeWidth={1.5} className="shrink-0 text-fg3" aria-hidden />;
}

/** Five 44px actions, their gaps and the panel's padding. */
const SWIPE_W = 5 * 44 + 4 * 2 + 16;

/** List row. Hover reveals actions; on touch, swipe left reveals them. */
function Row(props: ItemProps & { touch: boolean }) {
  const { it, touch } = props;
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLLIElement>) => {
    if (!touch || e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e: PointerEvent<HTMLLIElement>) => {
    if (!start.current || e.pointerId !== start.current.id) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (Math.abs(ddy) > Math.abs(ddx)) return;
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

  return (
    <li
      className="group relative touch-pan-y overflow-hidden border-b border-line last:border-b-0"
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
      {/* The checkbox hangs in a narrow margin and the progress ring trails the title, so text runs the width of the row. */}
      <div
        className={cn("relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 bg-bg2 px-5 py-4 transition-[background-color,transform] duration-fast group-hover:bg-bg3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-x-3.5", props.selected && "!bg-bg3")}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transitionProperty: start.current ? "background-color" : undefined }}
      >
        <DocumentSelection {...props} className="col-start-1 row-start-1 mt-1" />
        <button type="button" onClick={() => props.open(it)} className="col-start-2 row-start-1 line-clamp-2 border-0 bg-transparent p-0 text-left font-serif text-[17px] leading-[23px] text-fg hover:text-accent sm:text-[16px] sm:leading-6">
          {it.rec.title}
        </button>
        <Meta it={it} estimate={props.estimate} withDate className="col-start-2 row-start-2" />
        <div className="col-span-2 col-start-2 row-start-3 mt-1.5 sm:col-span-1 sm:col-start-2"><PreparedStatus it={it} defaultVoice={props.defaultVoice} onPrepare={() => props.prepare(it)} /></div>
        <ReadProgress value={it.progress} className="col-start-3 row-span-2 row-start-1 sm:col-start-4 sm:row-span-3 sm:row-start-1" />
        {!touch && <Actions {...props} className="col-span-2 col-start-2 row-start-4 -ml-2 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 sm:col-span-1 sm:col-start-3 sm:row-span-3 sm:row-start-1 sm:-my-0.5 sm:ml-0 sm:opacity-0" />}
      </div>
    </li>
  );
}

function CardItem(props: ItemProps) {
  const { it } = props;
  return (
    <li className={cn("group flex min-h-[170px] flex-col gap-3.5 rounded-card border border-line bg-bg2 p-[18px] transition-colors duration-fast hover:border-fg3", props.selected && "!border-accent")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3"><DocumentSelection {...props} /><ReadProgress value={it.progress} size={36} /></div>
        <Actions {...props} size={32} className="opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100" />
      </div>
      <div className="flex-1">
        <button type="button" onClick={() => props.open(it)} className="line-clamp-3 border-0 bg-transparent p-0 text-left font-serif text-[17px] leading-[1.35] text-fg hover:text-accent">
          {it.rec.title}
        </button>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line pt-3">
        <Meta it={it} estimate={props.estimate} />
        <PreparedStatus it={it} defaultVoice={props.defaultVoice} onPrepare={() => props.prepare(it)} />
      </div>
    </li>
  );
}

function DocumentSelection({ it, selected, toggleSelected, className }: ItemProps & { className?: string }) {
  return <input type="checkbox" aria-label={`Select ${it.rec.title}`} checked={selected} onChange={() => toggleSelected(it.rec.id)} onPointerDown={(e) => e.stopPropagation()} className={cn("size-4 shrink-0 cursor-pointer accent-[var(--accent)]", className)} />;
}
