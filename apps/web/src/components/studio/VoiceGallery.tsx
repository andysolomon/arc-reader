import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Plus, Search, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { Button, IconButton, Input, VoiceTile, cn, type PortraitVoice } from "@readaloud/ui";
import { voiceServiceTextColor } from "@readaloud/tokens";
import { useVoices } from "../../state/voices";
import { galleryFavoriteKey, useGallery } from "../../state/gallery";
import { usePreviews } from "../../state/previews";
import { hueFor } from "../../data/voices";
import { studioJson, studioUrl, idPath, type Archetype, type PreviewSource } from "../../lib/studio";
import { GALLERY_FACETS, NO_GALLERY_FILTERS, activeFilterCount, galleryParams, matchesGallery, type GalleryFilters } from "../../lib/filters";
import { ActiveFilters, FilterSelect, VOICE_GRID } from "../Filters";
import { ICON_ON } from "../IconMenu";
import { useIsTouch } from "../../hooks/useMedia";
import { GalleryPreview } from "./GalleryPreview";
import { ErrorNotice, useOperation } from "./shared";

const PAGE_SIZE = 24;

/** A recipe keeps one portrait here, in the preview and once saved to Voices: all are keyed by its id. */
const portraitOf = (voice: Archetype): PortraitVoice => ({ id: voice.id, archetype: voice.id, name: voice.name, description: voice.instruct, gender: voice.facets?.gender ?? voice.attrs?.Gender, age: voice.facets?.age ?? voice.attrs?.Age, hue: hueFor(voice.id), engine: "omnivoice" });

export function VoiceGallery() {
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filters, setFilters] = useState<GalleryFilters>(NO_GALLERY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const touch = useIsTouch();
  const size = touch ? 44 : 36;
  const glyph = touch ? 20 : 18;
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Archetype[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sources, setSources] = useState<Record<string, PreviewSource["source"] | "unknown">>({});
  const preview = usePreviews((s) => s.active);
  const generated = usePreviews((s) => s.ready);
  const jobs = usePreviews((s) => s.jobs);
  const openPreview = usePreviews((s) => s.open);
  const voices = useVoices((s) => s.voices);
  const voicesLoaded = useVoices((s) => s.loaded);
  const loadVoices = useVoices((s) => s.load);
  // Recipes already saved as voices belong to Voices now; send one back from there to see it here again.
  const inVoices = useMemo(() => new Set(voices.flatMap((v) => (v.archetype ? [v.archetype] : []))), [voices]);
  const favorites = useGallery((s) => s.favorites);
  const toggleFavorite = useGallery((s) => s.toggleFavorite);
  const op = useOperation();
  const favoriteVoices = useMemo(() => Object.entries(favorites)
    .filter(([key]) => key.startsWith(studioUrl("/archetypes/")))
    .map(([, voice]) => voice), [favorites]);
  const matchingFavorites = useMemo(() => {
    const search = query.trim().toLowerCase();
    return favoriteVoices.filter((voice) => !inVoices.has(voice.id) && matchesGallery(voice, filters) && [voice.name, voice.instruct, voice.language, voice.use_case].join(" ").toLowerCase().includes(search));
  }, [favoriteVoices, query, filters, inVoices]);
  const filterCount = activeFilterCount(filters);
  const setFilter = (key: keyof GalleryFilters, value: string) => { setFilters((f) => ({ ...f, [key]: value })); setPage(0); };
  const count = favoritesOnly ? matchingFavorites.length : total;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(count / PAGE_SIZE) - 1));
  const visibleItems = useMemo(() => favoritesOnly
    ? matchingFavorites.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    : items.filter((voice) => !inVoices.has(voice.id)), [favoritesOnly, matchingFavorites, currentPage, items, inVoices]);
  const hidden = favoritesOnly ? 0 : items.length - visibleItems.length;

  useEffect(() => { if (!voicesLoaded) void loadVoices(); }, [voicesLoaded, loadVoices]);

  useEffect(() => {
    if (favoritesOnly) { setLoading(false); setLoadError(""); return; }
    const ac = new AbortController();
    setLoading(true); setLoadError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams([["q", query], ["limit", String(PAGE_SIZE)], ["offset", String(page * PAGE_SIZE)], ...galleryParams(filters)]);
      if (featured) params.set("featured", "true");
      void studioJson<{ items: Archetype[]; total: number }>(`/archetypes?${params}`, { signal: ac.signal })
        .then((data) => { if (!ac.signal.aborted) { setItems(data.items); setTotal(data.total); } })
        .catch((e: Error) => { if (!ac.signal.aborted) setLoadError(e.message); })
        .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [query, featured, page, favoritesOnly, filters]);

  // Read only cache metadata, with bounded concurrency. Browsing never renders audio.
  useEffect(() => {
    const ac = new AbortController();
    const queue = [...visibleItems];
    const check = async () => {
      while (queue.length && !ac.signal.aborted) {
        const voice = queue.shift()!;
        let source: PreviewSource["source"] | "unknown" = "unknown";
        try {
          const state = await studioJson<PreviewSource>(`/archetypes/${idPath(voice.id)}/preview/state`, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(10_000)]), cache: "no-cache" });
          source = state.source;
        } catch { /* Status failure must not block browsing or trying a preview. */ }
        if (!ac.signal.aborted) setSources((before) => ({ ...before, [voice.id]: source }));
      }
    };
    for (let i = 0; i < Math.min(4, visibleItems.length); i++) void check();
    return () => ac.abort();
  }, [visibleItems]);

  const previewed = preview && [...items, ...favoriteVoices].find((voice) => voice.id === preview.id);

  return <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="m-0 font-serif text-xl">Designed voices</h2>
        <p role="status" className="m-0 text-[13px] tabular-nums text-fg2">{loading ? "Loading gallery…" : `${count} ${favoritesOnly ? "favorite " : ""}${count === 1 ? "voice" : "voices"}`}{hidden > 0 && ` · ${hidden} on this page already in Voices`}{op.status && ` · ${op.status}`}</p>
      </div>
      <p className="m-0 text-[13px] text-fg2">Tap a portrait to hear it. Voices you add move to <Link to="/voices" className="underline">Voices</Link>.</p>
    </div>
    <div className="-mr-2 flex items-center gap-1 sm:mr-0" role="search" aria-label="Find a designed voice">
      <Input type="search" aria-label="Search designed voices" placeholder="Narrator, British, whisper…" leading={<Search size={16} strokeWidth={1.5} aria-hidden />} wrapperClassName={cn("min-w-0 flex-1 sm:max-w-[320px]", touch && "h-10")} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
      <div className="flex gap-0.5 sm:ml-auto" role="group" aria-label="Gallery view">
        <IconButton label={`Favorites (${favoriteVoices.length})`} size={size} active={favoritesOnly} className={cn(favoritesOnly && ICON_ON)} onClick={() => { setFavoritesOnly(!favoritesOnly); setPage(0); }}>
          <Star size={glyph} strokeWidth={1.5} fill={favoritesOnly ? "currentColor" : "none"} />
        </IconButton>
        {!favoritesOnly && <IconButton label="Featured only" size={size} active={featured} className={cn(featured && ICON_ON)} onClick={() => { setFeatured(!featured); setPage(0); }}>
          <Sparkles size={glyph} strokeWidth={1.5} />
        </IconButton>}
        <IconButton label="Filters" size={size} aria-expanded={filtersOpen} aria-controls="gallery-filters" data-on={filterCount > 0 || undefined} className={cn(filtersOpen && "bg-bg3 text-fg", filterCount > 0 && ICON_ON)} onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal size={glyph} strokeWidth={1.5} />
        </IconButton>
      </div>
    </div>
    {filtersOpen && <fieldset id="gallery-filters" className="m-0 grid grid-cols-2 gap-3 rounded-panel border border-line bg-bg2 p-3 sm:grid-cols-4">
      <legend className="sr-only">Filter designed voices</legend>
      {GALLERY_FACETS.map((facet) => <FilterSelect key={facet.key} label={facet.label} any={facet.any} value={filters[facet.key]} options={facet.options} onChange={(value) => setFilter(facet.key, value)} />)}
    </fieldset>}
    <ActiveFilters clearAll={{ count: filterCount, onClear: () => { setFilters(NO_GALLERY_FILTERS); setPage(0); } }} filters={[
      ...(favoritesOnly ? [{ name: "Favorites", label: <span className="inline-flex items-center gap-1.5"><Star size={12} strokeWidth={1.5} fill="currentColor" className="text-accent" aria-hidden />Favorites</span>, clear: () => { setFavoritesOnly(false); setPage(0); } }] : []),
      ...GALLERY_FACETS.filter((facet) => filters[facet.key]).map((facet) => ({
        name: `${facet.label}: ${facet.options.find(([v]) => v === filters[facet.key])?.[1] ?? filters[facet.key]}`,
        clear: () => setFilter(facet.key, ""),
      })),
    ]} />
    {preview && <GalleryPreview id={preview.id} name={preview.name} voice={previewed ? portraitOf(previewed) : undefined} />}
    <ErrorNotice error={loadError || op.error} />
    {visibleItems.length > 0 && <div className={`${VOICE_GRID} rounded-panel border border-line bg-bg2 p-2 sm:p-4`}>
      {visibleItems.map((voice) => {
        const favorite = !!favorites[galleryFavoriteKey(voice.id)];
        const source = sources[voice.id];
        // Session completion wins over a status check that started before it finished.
        const ready = !!generated[voice.id] || source === "cached" || source === "gallery";
        const generating = !ready && !!jobs[voice.id] && !jobs[voice.id].done;
        return <VoiceTile key={voice.id} as="article" nameAs="h3" aria-label={voice.name} voice={portraitOf(voice)} source="VoiceStudio" selected={preview?.id === voice.id}
          preview={{ label: ready ? "Play preview" : "Preview", state: generating ? "generating" : undefined, onClick: () => { op.setError(""); openPreview(voice.id, voice.name); } }}
          corner={<button type="button" className={cn("grid size-9 place-items-center rounded-control border-0 bg-transparent hover:bg-bg3", favorite ? "text-accent" : "text-fg2 hover:text-fg")} aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${voice.name}`} aria-pressed={favorite} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => toggleFavorite(voice)}><Star size={18} strokeWidth={1.5} fill={favorite ? "currentColor" : "none"} aria-hidden /></button>}>
          <span className="inline-flex items-center gap-1 text-xs text-fg2" style={ready ? { color: voiceServiceTextColor("VoiceStudio") } : undefined}>
            {ready && <CheckCircle2 size={14} aria-hidden />}
            {ready ? "Preview ready" : generating ? "Generating preview…" : source === "rendering" ? "Not generated" : source === "no_model" ? "Model required" : source ? "Preview status unavailable" : "Checking preview…"}
          </span>
          <div className="flex max-w-full flex-col gap-0.5 text-[12px] text-fg2">
            <p className="m-0 font-mono text-[11px] uppercase">{voice.use_case} · {voice.language}</p>
            <p className="m-0 [overflow-wrap:anywhere]">{voice.instruct}</p>
          </div>
          <button type="button" disabled={op.busy} className="mt-auto inline-flex h-[34px] w-full select-none items-center justify-center gap-1.5 rounded-pill border border-line bg-bg2 text-[13px] font-semibold text-fg hover:bg-bg3 disabled:pointer-events-none disabled:opacity-50" onClick={() => void op.run(async (signal) => {
            const result = await studioJson<{ profile_id: string; name: string }>(`/archetypes/${idPath(voice.id)}/use`, { method: "POST", signal });
            await useVoices.getState().load(); op.setStatus(`${result.name} added to Voices.`);
          })}><Plus size={14} strokeWidth={2} aria-hidden />Add to Voices</button>
        </VoiceTile>;
      })}
    </div>}
    {!loading && !loadError && count > 0 && visibleItems.length === 0 && <p className="text-fg2">Every voice on this page is already in Voices.</p>}
    {!loading && count === 0 && !loadError && <p className="text-fg2">{favoritesOnly && !favoriteVoices.length ? "No favorites yet. Star a voice to keep it here." : filterCount ? "No voices match these filters." : "No voices match that search."}</p>}
    <div className="flex items-center justify-center gap-3"><Button pill disabled={currentPage === 0 || loading} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm text-fg2">Page {currentPage + 1}{count > PAGE_SIZE && ` of ${Math.ceil(count / PAGE_SIZE)}`}</span><Button pill disabled={(currentPage + 1) * PAGE_SIZE >= count || loading} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
  </div>;
}
