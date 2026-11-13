import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Dialog, Input, VoiceCard, VoiceSourceBadge, voiceAvatarIdentity, cn, type VoiceCardAction } from "@readaloud/ui";
import type { VoiceSource } from "@readaloud/tokens";
import { ImagePlus, Languages, Layers, LayoutGrid, Mic, Plus, Search, Shapes, Trash2, Undo2, WandSparkles } from "lucide-react";
import { useAvatars, avatarReviewNote } from "../state/avatars";
import { useVoices, getVoice, voiceLang, isLocalVoice, defaultVoiceId } from "../state/voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { useLibrary } from "../state/library";
import { toast } from "../state/toast";
import { docs } from "../lib/db";
import { synthesize, DEFAULT_ENGINE } from "../engine/providers";
import { ApiBusy, ApiRejected, ApiUnreachable } from "../engine/types";
import { JAMAICAN_PATOIS_VOICE_ID, SOURCE_INFO, voiceSource, type Voice } from "../data/voices";
import { preparePatois } from "../lib/patois";
import { NO_VOICE_FILTERS, activeFilterCount, facetCounts, filterVoices, languageLabel, voiceLanguage, voiceType, type VoiceFilters } from "../lib/filters";
import { ActiveFilters, VOICE_GRID, type ActiveFilter } from "../components/Filters";
import { IconMenu, MenuAction, MenuOption } from "../components/IconMenu";
import { useIsTouch } from "../hooks/useMedia";

// Filter chips follow the same fixed order as the sections below.
const sourceRank = (source: string) => { const i = Object.keys(SOURCE_INFO).indexOf(source); return i < 0 ? Infinity : i; };
const TYPE_LABELS: Record<string, string> = { "built-in": "Built-in", cloned: "Cloned", designed: "Designed" };

const PREVIEW_MS = 3000;

/** How much of the document a voice has saved audio for; silent when complete. */
function preparedNote(fraction: number | undefined) {
  if (fraction === undefined) return "Not prepared";
  const percent = Math.floor(fraction * 100);
  return percent < 100 ? `${percent}% prepared` : undefined;
}

export function VoicesPage() {
  const navigate = useNavigate();
  // Fingers get the full 44px; a pointer can do with less.
  const touch = useIsTouch();
  const size = touch ? 44 : 36;
  const glyph = touch ? 20 : 18;
  const avatarEntries = useAvatars((s) => s.entries);
  const avatarsConfigured = useAvatars((s) => s.configured);
  const pendingAvatars = Object.values(avatarEntries).filter((r) => r.status === "queued" || r.status === "generating").length;
  const failedAvatars = Object.values(avatarEntries).filter((r) => r.status === "failed").length;
  const [params] = useSearchParams();
  const forDoc = params.get("for");
  // From the player menu: only voices with audio saved for this document.
  const preparedOnly = !!forDoc && params.has("prepared");
  const selected = useSettings((s) => s.voice);
  const set = useSettings((s) => s.set);
  const engineId = useSettings((s) => s.engine);
  const VOICES = useVoices((s) => s.voices);
  const reload = useVoices((s) => s.load);
  const fishError = useVoices((s) => s.fishError);
  const speed = usePlayer((s) => s.speed);
  const loadedDoc = usePlayer((s) => s.doc);
  const docVoice = usePlayer((s) => s.voiceId);
  const hasDoc = !!loadedDoc;
  const libraryItems = useLibrary((s) => s.items);
  const refreshLibrary = useLibrary((s) => s.refresh);
  const [docTitle, setDocTitle] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<Voice | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [filters, setFilters] = useState<VoiceFilters>(NO_VOICE_FILTERS);
  const setFilter = (key: keyof VoiceFilters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const current = forDoc ? (loadedDoc?.id === forDoc ? docVoice : selected) : selected;
  const prepared = useMemo(() => (forDoc && libraryItems.find((it) => it.rec.id === forDoc)?.prepared) || [], [forDoc, libraryItems]);
  // The voice reading now stays listed so the selection is visible, even if its audio was never saved.
  const pool = useMemo(() => preparedOnly ? VOICES.filter((v) => v.id === current || prepared.some((p) => p.voiceId === v.id)) : VOICES, [VOICES, preparedOnly, current, prepared]);
  const shown = useMemo(() => filterVoices(pool, filters), [pool, filters]);
  const sources = useMemo(() => facetCounts(pool, voiceSource).sort(([a], [b]) => sourceRank(a) - sourceRank(b)), [pool]);
  const languages = useMemo(() => facetCounts(pool, voiceLanguage).sort(([a], [b]) => languageLabel(a).localeCompare(languageLabel(b))), [pool]);
  const types = useMemo(() => facetCounts(pool, voiceType), [pool]);
  const filterCount = activeFilterCount(filters);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!forDoc) return;
    if (loadedDoc?.id === forDoc) setDocTitle(loadedDoc.title);
    else void docs.get(forDoc).then((r) => setDocTitle(r?.title ?? null));
  }, [forDoc, loadedDoc]);
  // Prepared coverage is read from the audio cache; refresh it so a reading prepared moments ago counts.
  useEffect(() => {
    if (preparedOnly) void refreshLibrary();
  }, [preparedOnly, refreshLibrary]);

  const stopPreview = () => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    audio.current?.pause();
    if (audio.current?.src.startsWith("blob:")) URL.revokeObjectURL(audio.current.src);
    audio.current = null;
    window.speechSynthesis?.cancel();
    setPreviewing(null);
    setGenerating(false);
  };
  useEffect(() => stopPreview, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const preview = async (id: string) => {
    stopPreview();
    usePlayer.getState().clearOffline();
    const v = getVoice(id);
    setPreviewing(id);
    setGenerating(true);
    let text = `Hi, I'm ${v.name}. This is how I sound at your current speed.`;
    const ac = new AbortController();
    abort.current = ac;
    if (id === JAMAICAN_PATOIS_VOICE_ID) {
      try {
        const sample = await preparePatois({ id: "preview", title: "Preview", text, voice: id, source: "sample", domain: "Sample", chars: text.length, createdAt: 0, updatedAt: 0 }, ac.signal, () => {});
        text = sample.patois!.text;
      } catch (error) {
        if (!ac.signal.aborted) { toast(error instanceof Error ? error.message : "Patois preview failed"); stopPreview(); }
        return;
      }
    }
    // A preview exists to hear this voice: when the server cannot render it, say
    // so rather than quietly substituting the browser voice (which may be silent).
    const chunk = await synthesize({
      text,
      voice: v.id,
      engine: v.engine,
      openaiModel: useSettings.getState().openaiModel,
      profile: v.kind === "profile",
      signal: ac.signal,
      forceLocal: isLocalVoice(v.id) || (v.kind === "profile" && engineId === LOCAL_ENGINE),
      fallbackLocal: false,
    }).catch((error: unknown) => {
      if (ac.signal.aborted) return null;
      if (error instanceof ApiUnreachable) {
        // No document is open here, so the offline banner can't explain it: say it.
        usePlayer.setState({ offline: true });
        toast(`Speech server unreachable — can't preview ${v.name} right now`);
      } else if (error instanceof ApiBusy) {
        toast("VoiceStudio is busy with other speech. Try the preview again in a moment.");
      } else if (error instanceof ApiRejected) {
        toast(error.message);
      } else {
        toast(`Could not preview ${v.name}`);
      }
      return null;
    });
    if (ac.signal.aborted) return;
    if (!chunk) { stopPreview(); return; }
    setGenerating(false);
    if (chunk.audio) {
      const a = new Audio(URL.createObjectURL(chunk.audio));
      a.playbackRate = speed;
      a.onended = stopPreview;
      audio.current = a;
      a.play().catch(() => toast("Tap preview again to hear it"));
    } else if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voiceLang(v);
      u.rate = speed;
      u.onend = () => setPreviewing((p) => (p === id ? null : p));
      window.speechSynthesis.speak(u);
    }
    timer.current = setTimeout(stopPreview, PREVIEW_MS);
  };

  const use = async (id: string) => {
    const v = getVoice(id);
    if (v.kind === "preset" && engineId === LOCAL_ENGINE) set("engine", DEFAULT_ENGINE);
    usePlayer.getState().clearOffline();
    if (forDoc) {
      if (loadedDoc?.id === forDoc) {
        if (!await usePlayer.getState().setDocVoice(id)) return;
      }
      else {
        const rec = await docs.get(forDoc);
        if (rec) await docs.put({ ...rec, voice: id, updatedAt: Date.now() });
      }
      void useLibrary.getState().refresh();
      toast(`${v.name} will read “${docTitle ?? "this document"}”`);
      navigate(-1);
      return;
    }
    useSettings.getState().patch({ voice: id, voiceChosen: true });
    toast(`${v.name} selected`);
  };

  /** Remove a saved VoiceStudio voice; false when VoiceStudio refused, which the toast explains. */
  const removeProfile = async (v: Voice, failure: string) => {
    if (previewing === v.id) stopPreview();
    try {
      await useVoices.getState().remove(v.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : failure);
      return false;
    }
    if (useSettings.getState().voice === v.id) useSettings.getState().patch({ voice: defaultVoiceId(), voiceChosen: false });
    return true;
  };
  // A gallery voice goes back to Studio: its recipe lives on there. Clones and voices designed
  // in Studio are deleted for good (the reference recording or recipe goes too), so ask first.
  const demote = async (v: Voice) => {
    if (await removeProfile(v, `Could not send ${v.name} back to Studio`)) toast(`${v.name} sent back to the Studio gallery`);
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    const ok = await removeProfile(deleting, `Could not delete ${deleting.name}`);
    setDeleteBusy(false);
    if (ok) toast(`${deleting.name} deleted`);
    setDeleting(null);
  };
  const profileActionsFor = (v: Voice): VoiceCardAction[] | undefined => {
    if (v.kind !== "profile") return undefined;
    if (v.archetype) return [{ label: `Send ${v.name} back to Studio`, icon: <Undo2 size={16} strokeWidth={1.5} aria-hidden />, onClick: () => void demote(v) }];
    const remove: VoiceCardAction = { label: `Delete ${v.name}`, icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />, onClick: () => setDeleting(v), danger: true };
    if (!v.tags.includes("cloned")) return [remove];
    return [{ label: `Re-record ${v.name}`, icon: <Mic size={16} strokeWidth={1.5} aria-hidden />, onClick: () => { stopPreview(); navigate(`/studio/clone?voice=${encodeURIComponent(v.id)}`); } }, remove];
  };


  const actionsFor = (v: Voice): VoiceCardAction[] => {
    const actions = profileActionsFor(v) ?? [];
    const entry = avatarEntries[voiceAvatarIdentity(v)];
    if (!avatarsConfigured || v.kind === "local" || entry?.status === "ready") return actions;
    const pending = entry?.status === "queued" || entry?.status === "generating";
    return [{
      label: pending ? `Creating avatar for ${v.name}` : entry?.status === "failed" ? `Retry avatar for ${v.name}: ${entry.error}` : `Create illustrated avatar for ${v.name}`,
      icon: <ImagePlus size={16} strokeWidth={1.5} aria-hidden />,
      onClick: () => {
        if (pending) { toast(`The avatar for ${v.name} is being created.`); return; }
        void useAvatars.getState().ensure(v, true).then(() => toast(`Creating an avatar for ${v.name}. It will appear automatically.`)).catch((e) => toast(e instanceof Error ? e.message : "Could not create avatar."));
      },
    }, ...actions];
  };

  // Group by the service that renders each voice. Sections keep a fixed order:
  // the store's order depends on which provider answered first.
  const bySource = new Map<VoiceSource, typeof VOICES>((Object.keys(SOURCE_INFO) as VoiceSource[]).map((s) => [s, []]));
  for (const v of shown) bySource.set(voiceSource(v), [...(bySource.get(voiceSource(v)) ?? []), v]);
  const groups = [...bySource].filter(([, voices]) => voices.length);

  return (
    <section data-screen="voices" className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 sm:px-10 sm:pt-10 animate-fadein" style={{ paddingBottom: hasDoc ? 160 : 64 }}>
      <div className="mx-auto flex max-w-[880px] flex-col gap-4">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5 sm:flex-none">
            <h1 className="m-0 font-serif text-[26px] font-medium">Voices</h1>
            <span role="status" className="truncate text-[13px] tabular-nums text-fg2">{filterCount ? `${shown.length} of ${pool.length}` : pool.length} {pool.length === 1 ? "voice" : "voices"}</span>
          </div>
          {/* On a phone the search and its filters take the second line; from a tablet up everything shares one. */}
          <div className="order-last -mr-2 flex min-w-0 basis-full items-center gap-1 sm:order-none sm:mr-0 sm:flex-1 sm:basis-0 sm:justify-end" role="search" aria-label="Filter voices">
            <Input type="search" aria-label="Search voices" placeholder="Search voices" leading={<Search size={16} strokeWidth={1.5} aria-hidden />} wrapperClassName={cn("min-w-0 flex-1 sm:max-w-[240px]", touch && "h-10")} value={filters.query} onChange={(e) => setFilter("query", e.target.value)} />
            <div className="flex gap-0.5" role="group" aria-label="Filters">
              <IconMenu label="Filter by source" icon={<Layers size={glyph} strokeWidth={1.5} />} on={!!filters.source} size={size} width={240}>
                {(close) => <>
                  <MenuOption checked={!filters.source} onSelect={() => { setFilter("source", ""); close(); }}>All sources</MenuOption>
                  {sources.map(([source, n]) => <MenuOption key={source} checked={filters.source === source} count={n} onSelect={() => { setFilter("source", source); close(); }}><VoiceSourceBadge source={source as VoiceSource} /></MenuOption>)}
                </>}
              </IconMenu>
              {languages.length > 1 && <IconMenu label="Filter by language" icon={<Languages size={glyph} strokeWidth={1.5} />} on={!!filters.language} size={size} width={240}>
                {(close) => <>
                  <MenuOption checked={!filters.language} onSelect={() => { setFilter("language", ""); close(); }}>All languages</MenuOption>
                  {languages.map(([code, n]) => <MenuOption key={code} checked={filters.language === code} count={n} onSelect={() => { setFilter("language", code); close(); }}>{languageLabel(code)}</MenuOption>)}
                </>}
              </IconMenu>}
              {types.length > 1 && <IconMenu label="Filter by type" icon={<Shapes size={glyph} strokeWidth={1.5} />} on={!!filters.type} size={size} width={200}>
                {(close) => <>
                  <MenuOption checked={!filters.type} onSelect={() => { setFilter("type", ""); close(); }}>All types</MenuOption>
                  {types.map(([type, n]) => <MenuOption key={type} checked={filters.type === type} count={n} onSelect={() => { setFilter("type", type); close(); }}>{TYPE_LABELS[type]}</MenuOption>)}
                </>}
              </IconMenu>}
            </div>
          </div>
          <div className="-mr-2 flex sm:mr-0">
            <IconMenu label="Make a voice" icon={<Plus size={glyph} strokeWidth={1.5} />} size={size} width={232}>
              {(close) => <>
                <MenuAction icon={<Mic size={15} strokeWidth={1.5} />} onSelect={() => { close(); navigate("/studio/clone"); }}>Clone a voice</MenuAction>
                <MenuAction icon={<WandSparkles size={15} strokeWidth={1.5} />} onSelect={() => { close(); navigate("/studio/design"); }}>Design a voice</MenuAction>
                <MenuAction icon={<LayoutGrid size={15} strokeWidth={1.5} />} onSelect={() => { close(); navigate("/studio/gallery"); }}>Browse designed voices</MenuAction>
              </>}
            </IconMenu>
          </div>
        </header>
        {forDoc && <p className="m-0 text-[13px] text-fg2">
          {preparedOnly ? `Choosing a prepared voice for “${docTitle ?? "this document"}”. Only voices with audio saved for it are listed.` : `Choosing a voice for “${docTitle ?? "this document"}”.`}
        </p>}
        {fishError && (
          <div role="status" className="rounded-panel border border-line bg-bg2 p-4 text-[13px] text-fg2">
            Fish Audio voices could not refresh: {fishError}. Your other voices are still available.
            <button type="button" onClick={() => void reload()} className="ml-2 border-0 bg-transparent text-accent underline">Retry</button>
          </div>
        )}
        {(pendingAvatars > 0 || failedAvatars > 0) && <p role="status" className="m-0 text-[13px] text-fg2">
          {pendingAvatars > 0 && `Creating ${pendingAvatars} voice avatar${pendingAvatars === 1 ? "" : "s"}. Portraits appear automatically. `}
          {failedAvatars > 0 && `${failedAvatars} avatar${failedAvatars === 1 ? "" : "s"} could not be created. Use the image button on a voice to retry.`}
        </p>}
        <ActiveFilters clearAll={{ count: filterCount, onClear: () => setFilters(NO_VOICE_FILTERS) }} filters={([
          filters.source && { name: SOURCE_INFO[filters.source]?.title ?? filters.source, label: <VoiceSourceBadge source={filters.source as VoiceSource} />, clear: () => setFilter("source", "") },
          filters.language && { name: languageLabel(filters.language), clear: () => setFilter("language", "") },
          filters.type && { name: TYPE_LABELS[filters.type] ?? filters.type, clear: () => setFilter("type", "") },
        ] as (ActiveFilter | "")[]).filter((f): f is ActiveFilter => !!f)} />
        {preparedOnly && !pool.some((v) => v.id !== current) && (
          <p role="status" className="rounded-panel border border-line bg-bg2 p-4 text-[13px] text-fg2">
            No other voice has prepared audio for this document yet. Use “Prepare audio” in the player menu, or prepare more voices from the <Link to="/library" className="text-accent underline">Library</Link>.
          </p>
        )}
        {!shown.length && pool.length > 0 && <p className="text-fg2">No voices match these filters.</p>}
        {groups.map(([source, voices]) => (
          <section key={source} aria-labelledby={`voices-${source}`} className="flex flex-col gap-3 rounded-panel border border-line bg-bg2 p-2 sm:p-4">
            <div className="px-2 pt-2 sm:px-1 sm:pt-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 id={`voices-${source}`} className="m-0 font-serif text-xl"><VoiceSourceBadge source={source} className="px-3 py-1 text-sm" /></h2>
                <span className="text-xs text-fg2">{voices.length === 1 ? "1 voice" : `${voices.length} voices`}</span>
              </div>
              {SOURCE_INFO[source] && <p className="mt-1.5 text-[13px] text-fg2">{SOURCE_INFO[source].description}</p>}
              {voices.some((v) => v.id === JAMAICAN_PATOIS_VOICE_ID) && <p className="mt-1 text-[13px] text-fg2">Jamaican English reads your original wording. Jamaican Patois rewrites English into Patois before reading, using OpenAI for the rewrite and Fish Audio for speech. Your original is kept.</p>}
            </div>
            <div className={VOICE_GRID}>
              {voices.map((v) => (
                <VoiceCard key={v.id} voice={v} source={source} selected={current === v.id} previewing={previewing === v.id} generating={previewing === v.id && generating} onPreview={() => (previewing === v.id ? stopPreview() : void preview(v.id))} onSelect={() => void use(v.id)}
                  note={[preparedOnly ? preparedNote(prepared.find((p) => p.voiceId === v.id)?.fraction) : undefined, avatarReviewNote(avatarEntries[voiceAvatarIdentity(v)])].filter(Boolean).join(" · ") || undefined}
                  actions={actionsFor(v)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <Dialog open={!!deleting} onClose={() => { if (!deleteBusy) setDeleting(null); }} title={`Delete ${deleting?.name ?? "voice"}?`}>
        <p className="text-sm text-fg2">
          {deleting?.tags.includes("cloned") ? "Its reference recording is removed from VoiceStudio and can't be recovered." : "Its recipe is removed from VoiceStudio and can't be recovered."}{" "}
          Documents set to this voice will need another one.
          {deleting?.tags.includes("cloned") && <> To keep the voice but change how it sounds, re-record it instead.</>}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button>
          <Button variant="danger" loading={deleteBusy} onClick={() => void confirmDelete()}>Delete voice</Button>
        </div>
      </Dialog>
    </section>
  );
}
