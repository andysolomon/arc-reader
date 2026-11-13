import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input, VoiceAvatar, cn } from "@readaloud/ui";
import { useVoices, getVoice } from "../state/voices";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { DEFAULT_ENGINE } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
import type { Voice } from "../data/voices";

/** Above this many voices the picker offers a search field. */
const SEARCH_FROM = 8;

/** How much of the document a voice has saved audio for; silent when complete. */
function preparedNote(fraction: number) {
  const percent = Math.floor(fraction * 100);
  return percent < 100 ? `${percent}% prepared` : "Prepared";
}

/**
 * Choose the voice for the document that is playing, without leaving it. Voices with audio
 * saved for this document come first: switching to them keeps playing straight away.
 */
export function VoicePicker({ docId, title, onDone, onBrowse, className }: {
  docId: string;
  title: string;
  onDone: () => void;
  onBrowse: () => void;
  className?: string;
}) {
  const voices = useVoices((s) => s.voices);
  const current = usePlayer((s) => s.voiceId);
  const items = useLibrary((s) => s.items);
  const refreshLibrary = useLibrary((s) => s.refresh);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  // Prepared coverage is read from the audio cache; refresh it so a reading prepared moments ago counts.
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);
  useEffect(() => { list.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus({ preventScroll: true }); }, []);

  const prepared = useMemo(() => items.find((it) => it.rec.id === docId)?.prepared ?? [], [items, docId]);
  const q = query.trim().toLowerCase();
  const matches = (v: Voice) => !q || v.name.toLowerCase().includes(q) || (v.tags ?? []).some((t) => t.toLowerCase().includes(q));
  // The voice reading now stays at the top so the selection is visible, even if its audio was never saved.
  const ready = useMemo(() => {
    const ids = new Set([current, ...prepared.map((p) => p.voiceId)]);
    return [...ids].map((id) => voices.find((v) => v.id === id) ?? getVoice(id));
  }, [voices, prepared, current]);
  const others = useMemo(() => voices.filter((v) => !ready.some((r) => r.id === v.id)), [voices, ready]);
  const shownReady = ready.filter(matches);
  const shownOthers = others.filter(matches);

  const choose = async (id: string) => {
    if (busy) return;
    if (id === current) { onDone(); return; }
    const v = getVoice(id);
    const settings = useSettings.getState();
    if (v.kind === "preset" && settings.engine === LOCAL_ENGINE) settings.set("engine", DEFAULT_ENGINE);
    usePlayer.getState().clearOffline();
    setBusy(true);
    const changed = await usePlayer.getState().setDocVoice(id).finally(() => setBusy(false));
    if (!changed) return;
    void useLibrary.getState().refresh();
    toast(`${v.name} will read “${title}”`);
    onDone();
  };

  const row = (v: Voice, note?: string) => {
    const selected = v.id === current;
    return (
      <button
        key={v.id}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        disabled={busy}
        onClick={() => void choose(v.id)}
        className={cn(
          "flex min-h-[44px] w-full items-center gap-3 rounded-control border-0 bg-transparent px-2 py-1.5 text-left hover:bg-bg3 focus-visible:bg-bg3 disabled:opacity-60",
          selected && "bg-bg3",
        )}
      >
        <VoiceAvatar voice={v} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-fg">{v.name}</span>
          {note && <span className="block truncate text-[12px] text-fg2">{note}</span>}
        </span>
        {selected && <Check size={16} strokeWidth={2} className="shrink-0 text-accent" aria-label="Reading now" />}
      </button>
    );
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {voices.length > SEARCH_FROM && (
        <Input
          leading={<Search size={14} strokeWidth={1.5} />}
          placeholder="Find a voice"
          aria-label="Find a voice"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          wrapperClassName="mx-1 shrink-0"
        />
      )}
      <div ref={list} role="menu" aria-label={`Voice for ${title}`} className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        {shownReady.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-fg2">For this document</div>
            {shownReady.map((v) => {
              const p = prepared.find((x) => x.voiceId === v.id);
              return row(v, p ? preparedNote(p.fraction) : v.id === current ? "Reading now" : undefined);
            })}
          </>
        )}
        {shownOthers.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-fg2">Other voices</div>
            {shownOthers.map((v) => row(v, "Generates as it reads"))}
          </>
        )}
        {!shownReady.length && !shownOthers.length && <p className="m-0 px-2 py-3 text-[13px] text-fg2">No voice matches “{query}”.</p>}
      </div>
      <button type="button" onClick={onBrowse} className="mx-1 shrink-0 self-start border-0 bg-transparent px-1 py-1.5 text-[13px] text-accent hover:underline">
        Browse all voices
      </button>
    </div>
  );
}
