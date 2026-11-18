import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input, VoiceAvatar, cn } from "@readaloud/ui";
import { VOICE_SERVICES, voiceServiceColor, voiceServiceTextColor, type VoiceSource } from "@readaloud/tokens";
import { useVoices, getVoice } from "../state/voices";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { usePremiumContext } from "../state/premium";
import { toast } from "../state/toast";
import { DEFAULT_ENGINE, FISH_ENGINE, FISH_MODEL, isPaidEngine, openaiModelFor } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";
import { JAMAICAN_PATOIS_VOICE_ID, voiceSource, type Voice } from "../data/voices";
import { NO_VOICE_FILTERS, filterVoices } from "../lib/filters";
import { hasPatois } from "../lib/patois";
import { readingCost } from "../lib/premiumEstimate";
import { formatUsd } from "../lib/usage";
import { voiceTraits } from "../lib/voiceTraits";

/** Above this many voices the picker offers a search field. */
const SEARCH_FROM = 8;

const HEADING = "text-[11px] font-medium uppercase tracking-wide text-fg2";

/** How much of the document a voice has saved audio for. */
function preparedNote(fraction: number) {
  const percent = Math.floor(fraction * 100);
  return percent < 100 ? `${percent}% prepared` : "Prepared";
}

/**
 * Choose the voice for the document that is playing, without leaving it. Voices with audio
 * saved for this document come first: switching to them keeps playing straight away. The rest
 * are grouped by the service that renders them, which says once what choosing it costs, so
 * each row is left to say what its voice sounds like.
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
  const openaiModel = useSettings((s) => s.openaiModel);
  const premium = usePremiumContext();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  // Prepared coverage is read from the audio cache; refresh it so a reading prepared moments ago counts.
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);
  useEffect(() => { list.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus({ preventScroll: true }); }, []);

  const item = useMemo(() => items.find((it) => it.rec.id === docId), [items, docId]);
  const rec = item?.rec;
  const prepared = useMemo(() => item?.prepared ?? [], [item]);
  // The voice reading now stays at the top so the selection is visible, even if its audio was never saved.
  const ready = useMemo(() => {
    const ids = new Set([current, ...prepared.map((p) => p.voiceId)]);
    return [...ids].map((id) => voices.find((v) => v.id === id) ?? getVoice(id));
  }, [voices, prepared, current]);
  const others = useMemo(() => voices.filter((v) => !ready.some((r) => r.id === v.id)), [voices, ready]);
  const search = { ...NO_VOICE_FILTERS, query };
  const shownReady = filterVoices(ready, search);
  // Services keep a fixed order: the store's order depends on which provider answered first.
  const groups = (Object.keys(VOICE_SERVICES) as VoiceSource[])
    .map((source) => [source, filterVoices(others, search).filter((v) => voiceSource(v) === source)] as const)
    .filter(([, members]) => members.length);

  /** What a paid voice would bill for the audio this document has not saved yet; null when free or unpriced. */
  const cost = useMemo(() => {
    // Voices on one service and model cost the same, so the document is measured once for each.
    const whole = new Map<string, number | null>();
    return (v: Voice): number | null => {
      if (!rec || !isPaidEngine(v.engine)) return null;
      const patois = v.id === JAMAICAN_PATOIS_VOICE_ID;
      // The Patois rewrite decides how much is spoken; until it exists there is nothing to price.
      if (patois && !hasPatois(rec)) return null;
      const provider = v.engine === FISH_ENGINE ? "fish" as const : "openai" as const;
      const model = provider === "fish" ? FISH_MODEL : openaiModelFor({ voice: v.id, openaiModel });
      const key = `${provider}:${model}:${patois}`;
      if (!whole.has(key)) whole.set(key, readingCost(patois ? { ...rec, text: rec.patois!.text } : rec, provider, model, premium.calibration, { explainable: premium.explainable }));
      const full = whole.get(key) ?? null;
      return full === null ? null : full * (1 - (prepared.find((p) => p.voiceId === v.id)?.fraction ?? 0));
    };
  }, [rec, prepared, openaiModel, premium]);
  const priced = (list: readonly Voice[]) => list.map(cost).filter((c): c is number => c !== null && c > 0);
  const sameCost = (list: readonly Voice[]) => new Set(priced(list).map(formatUsd)).size < 2;

  /** What choosing from a service means for this document: free, or what the reading would bill. */
  const serviceNote = (source: VoiceSource, list: readonly Voice[]) => {
    const costs = priced(list);
    if (!costs.length) return VOICE_SERVICES[source].summary;
    const [low, high] = [formatUsd(Math.min(...costs)), formatUsd(Math.max(...costs))];
    return `≈${low === high ? low : `${low}–${high}`} to read this document`;
  };

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

  const row = (v: Voice, status: string | undefined, details: (string | false | null | undefined)[]) => {
    const selected = v.id === current;
    const detail = details.filter(Boolean).join(" · ");
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
          {(status || detail) && (
            <span className="line-clamp-2 text-[12px] leading-snug text-fg2">
              {status && <span className="text-fg">{status}</span>}
              {status && detail && " · "}
              {detail}
            </span>
          )}
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
          <div role="group" aria-label="For this document">
            <div className={cn(HEADING, "px-2 pb-1 pt-1")}>For this document</div>
            {shownReady.map((v) => {
              const p = prepared.find((x) => x.voiceId === v.id);
              const due = cost(v);
              // These voices come from any service, so each row names its own and what is left to pay.
              return row(v, p ? preparedNote(p.fraction) : v.id === current ? "Reading now" : undefined, [
                voiceTraits(v),
                VOICE_SERVICES[voiceSource(v)].title,
                !!due && `≈${formatUsd(due)} ${p ? "for the rest" : "to read"}`,
              ]);
            })}
          </div>
        )}
        {groups.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2 px-2 pt-3">
            <span className={HEADING}>Other voices</span>
            <span className="text-[12px] text-fg2">Audio is generated as they read</span>
          </div>
        )}
        {groups.map(([source, members]) => {
          const service = VOICE_SERVICES[source];
          const note = serviceNote(source, members);
          const same = sameCost(members);
          return (
            <div key={source} role="group" aria-label={`${service.title}: ${note}`}>
              {/* Stays in view while its voices scroll, so a long list still says which service it is. */}
              <div className="sticky top-0 z-[1] flex flex-wrap items-center gap-x-2 bg-bg2 px-2 pb-1 pt-2.5 text-[12px]" title={service.description}>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: service.hue === null ? "var(--fg2)" : voiceServiceColor(source) }} />
                <span className="font-medium" style={{ color: voiceServiceTextColor(source) }}>{service.title}</span>
                <span className="text-fg2">{note}</span>
              </div>
              {members.map((v) => {
                const due = cost(v);
                // One price for the whole service is in its heading; a voice says its own only when they differ.
                return row(v, undefined, [voiceTraits(v), !same && !!due && `≈${formatUsd(due)}`]);
              })}
            </div>
          );
        })}
        {!shownReady.length && !groups.length && <p className="m-0 px-2 py-3 text-[13px] text-fg2">No voice matches “{query}”.</p>}
      </div>
      <button type="button" onClick={onBrowse} className="mx-1 shrink-0 self-start border-0 bg-transparent px-1 py-1.5 text-[13px] text-accent hover:underline">
        Browse all voices
      </button>
    </div>
  );
}
