import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, LayoutList, LayoutGrid, Play, RotateCw, Trash2, Zap } from "lucide-react";
import { Button, Chip, EmptyState, IconButton, Input, ProgressRing, fmtTime, cn } from "@readaloud/ui";
import { getVoice, useVoices } from "../state/voices";
import { useLibrary, type LibraryItem } from "../state/library";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { dateLabel } from "../lib/dates";
import { openDocument } from "../lib/openDoc";
import { FOCUS_SEARCH_EVENT } from "../hooks/useShortcuts";
import { useBreakpoint, useIsTouch } from "../hooks/useMedia";
import { audioCache } from "../lib/db";
import { PreparationQueue, PrepareDialog, PreparedStatus } from "../components/LibraryPreparation";

export function LibraryPage() {
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const touch = useIsTouch();
  const { items, loaded, refresh, remove } = useLibrary();
  const libView = useSettings((s) => s.libView);
  const set = useSettings((s) => s.set);
  const defaultVoice = useSettings((s) => s.voice);
  const openaiModel = useSettings((s) => s.openaiModel);
  const voices = useVoices((s) => s.voices);
  const hasDoc = usePlayer((s) => !!s.doc);
  const [q, setQ] = useState("");
  const [vf, setVf] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prepareIds, setPrepareIds] = useState<string[] | null>(null);
  const closePrepare = useCallback(() => setPrepareIds(null), []);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, [refresh, voices, openaiModel]);
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
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      const v = it.rec.voice ?? defaultVoice;
      if (vf && v !== vf && !it.prepared.some((p) => p.voiceId === vf)) return false;
      if (!needle) return true;
      return it.rec.title.toLowerCase().includes(needle) || it.rec.domain.toLowerCase().includes(needle);
    });
  }, [items, q, vf, defaultVoice]);

  const grid = bp === "md" || libView === "grid";
  const selectedItems = items.filter((it) => selected.has(it.rec.id));
  const allVisibleSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.rec.id));
  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const act = {
    resume: (it: LibraryItem) => void openDocument(it.rec, navigate, { autoplay: true, resume: it.progress < 1 }),
    revoice: (it: LibraryItem) => navigate(`/voices?for=${it.rec.id}`),
    prepare: (it: LibraryItem) => setPrepareIds([it.rec.id]),
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
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by voice">
            <Chip size="sm" selected={vf === null} onClick={() => setVf(null)}>
              All voices
            </Chip>
            {usedVoices.map((id) => (
              <Chip key={id} size="sm" selected={vf === id} onClick={() => setVf(id)}>
                {voiceName(id)}
              </Chip>
            ))}
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
              Select {q || vf ? "visible" : "all"}
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
              <button type="button" onClick={() => { setQ(""); setVf(null); }} className="border-0 bg-transparent p-0 text-accent hover:text-fg">
                Clear filters
              </button>
            }
          >
            Nothing here matches.
          </EmptyState>
        )}
        {filtered.length > 0 && !grid && (
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-line bg-bg2 p-0">
            {filtered.map((it) => (
              <Row key={it.rec.id} it={it} touch={touch} defaultVoice={defaultVoice} selected={selected.has(it.rec.id)} {...act} />
            ))}
          </ul>
        )}
        {filtered.length > 0 && grid && (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5 p-0">
            {filtered.map((it) => (
              <CardItem key={it.rec.id} it={it} defaultVoice={defaultVoice} selected={selected.has(it.rec.id)} {...act} />
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
  toggleSelected: (id: string) => void;
  prepare: (it: LibraryItem) => void;
  resume: (it: LibraryItem) => void;
  revoice: (it: LibraryItem) => void;
  del: (it: LibraryItem) => void;
}

function Actions({ it, resume, revoice, prepare, del, size = 36, className }: ItemProps & { size?: 32 | 36 | 44; className?: string }) {
  return (
    <div className={cn("flex gap-0.5", className)}>
      <IconButton label="Resume" size={size} onClick={() => resume(it)}>
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

function Meta({ it, defaultVoice, withDate }: { it: LibraryItem; defaultVoice: string; withDate?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2.5 text-[12px] text-fg2">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-[3px] border border-line bg-bg3" aria-hidden />
        {it.rec.domain}
      </span>
      <span className="tabular-nums">{fmtTime(it.duration)}</span>
      <span>{getVoice(it.rec.voice ?? defaultVoice).name}</span>
      {withDate && <span>{dateLabel(it.rec.updatedAt)}</span>}
    </div>
  );
}

/** Four 44px actions, their gaps and the panel's padding. */
const SWIPE_W = 4 * 44 + 3 * 2 + 16;

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
      <div
        className={cn("relative grid grid-cols-[auto_36px_minmax(0,1fr)] items-center gap-3 bg-bg2 px-[18px] py-3.5 transition-[background-color,transform] duration-fast group-hover:bg-bg3 sm:grid-cols-[auto_36px_minmax(0,1fr)_auto]", props.selected && "!bg-bg3")}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transitionProperty: start.current ? "background-color" : undefined }}
      >
        <DocumentSelection {...props} />
        <div className="flex flex-col items-center gap-1"><ProgressRing value={it.progress} /><span className="text-[10px] text-fg2">Read</span></div>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <button type="button" onClick={() => props.resume(it)} className="truncate border-0 bg-transparent p-0 text-left font-serif text-[16px] text-fg hover:text-accent">
            {it.rec.title}
          </button>
          <Meta it={it} defaultVoice={props.defaultVoice} withDate />
          <PreparedStatus it={it} defaultVoice={props.defaultVoice} onPrepare={() => props.prepare(it)} />
        </div>
        {!touch && <Actions {...props} className="col-start-3 sm:col-start-auto sm:opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100" />}
      </div>
    </li>
  );
}

function CardItem(props: ItemProps) {
  const { it } = props;
  return (
    <li className={cn("group flex min-h-[170px] flex-col gap-3.5 rounded-card border border-line bg-bg2 p-[18px] transition-colors duration-fast hover:border-fg3", props.selected && "!border-accent")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2"><DocumentSelection {...props} /><div className="flex flex-col items-center gap-1"><ProgressRing value={it.progress} /><span className="text-[10px] text-fg2">Read</span></div></div>
        <Actions {...props} size={32} className="opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100" />
      </div>
      <button type="button" onClick={() => props.resume(it)} className="line-clamp-3 flex-1 border-0 bg-transparent p-0 text-left font-serif text-[17px] leading-[1.35] text-fg hover:text-accent">
        {it.rec.title}
      </button>
      <Meta it={it} defaultVoice={props.defaultVoice} />
      <PreparedStatus it={it} defaultVoice={props.defaultVoice} onPrepare={() => props.prepare(it)} />
    </li>
  );
}

function DocumentSelection({ it, selected, toggleSelected }: ItemProps) {
  return <input type="checkbox" aria-label={`Select ${it.rec.title}`} checked={selected} onChange={() => toggleSelected(it.rec.id)} onPointerDown={(e) => e.stopPropagation()} className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />;
}
