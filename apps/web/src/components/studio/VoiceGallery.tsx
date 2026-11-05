import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Play, Star } from "lucide-react";
import { Button, VoiceAvatar, cn } from "@readaloud/ui";
import { useVoices } from "../../state/voices";
import { galleryFavoriteKey, useGallery } from "../../state/gallery";
import { usePreviews } from "../../state/previews";
import { hueFor } from "../../data/voices";
import { studioJson, studioUrl, idPath, type Archetype, type PreviewSource } from "../../lib/studio";
import { GalleryPreview } from "./GalleryPreview";
import { Field, ErrorNotice, fieldClass, panelClass, useOperation } from "./shared";

const PAGE_SIZE = 24;

export function VoiceGallery() {
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const favorites = useGallery((s) => s.favorites);
  const toggleFavorite = useGallery((s) => s.toggleFavorite);
  const op = useOperation();
  const favoriteVoices = useMemo(() => Object.entries(favorites)
    .filter(([key]) => key.startsWith(studioUrl("/archetypes/")))
    .map(([, voice]) => voice), [favorites]);
  const matchingFavorites = useMemo(() => {
    const search = query.trim().toLowerCase();
    return favoriteVoices.filter((voice) => [voice.name, voice.instruct, voice.language, voice.use_case].join(" ").toLowerCase().includes(search));
  }, [favoriteVoices, query]);
  const count = favoritesOnly ? matchingFavorites.length : total;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(count / PAGE_SIZE) - 1));
  const visibleItems = useMemo(() => favoritesOnly
    ? matchingFavorites.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    : items, [favoritesOnly, matchingFavorites, currentPage, items]);

  useEffect(() => {
    if (favoritesOnly) { setLoading(false); setLoadError(""); return; }
    const ac = new AbortController();
    setLoading(true); setLoadError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (featured) params.set("featured", "true");
      void studioJson<{ items: Archetype[]; total: number }>(`/archetypes?${params}`, { signal: ac.signal })
        .then((data) => { if (!ac.signal.aborted) { setItems(data.items); setTotal(data.total); } })
        .catch((e: Error) => { if (!ac.signal.aborted) setLoadError(e.message); })
        .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [query, featured, page, favoritesOnly]);

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

  return <div className="flex flex-col gap-5">
    <div><h2 className="font-serif text-xl">Designed voice gallery</h2><p className="mt-2 text-sm text-fg2">VoiceStudio’s original catalog. Preview a character, favorite it, or add its recipe to your saved voices. <Link to="/voices" className="underline">Find Fish and ChatGPT voices in Voices.</Link></p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Gallery view">
      <Button variant={favoritesOnly ? "secondary" : "primary"} aria-pressed={!favoritesOnly} onClick={() => { setFavoritesOnly(false); setPage(0); }}>All voices</Button>
      <Button variant={favoritesOnly ? "primary" : "secondary"} aria-pressed={favoritesOnly} onClick={() => { setFavoritesOnly(true); setPage(0); }}><Star size={14} aria-hidden />Favorites ({favoriteVoices.length})</Button>
    </div>
    <div className="flex flex-wrap items-end gap-4"><div className="min-w-0 flex-1"><Field label="Search designed voices"><input className={fieldClass} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Narrator, British, whisper…" /></Field></div>{!favoritesOnly && <label className="flex items-center gap-2 py-3 text-sm"><input type="checkbox" checked={featured} onChange={(e) => { setFeatured(e.target.checked); setPage(0); }} />Featured only</label>}</div>
    {preview && <GalleryPreview id={preview.id} name={preview.name} />}
    <p role="status" className="text-sm text-fg2">{loading ? "Loading gallery…" : `${count} ${favoritesOnly ? "favorite voices" : "voices"}`}{op.status && ` · ${op.status}`}</p>
    <ErrorNotice error={loadError || op.error} />
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {visibleItems.map((voice) => {
        const favorite = !!favorites[galleryFavoriteKey(voice.id)];
        const source = sources[voice.id];
        // Session completion wins over a status check that started before it finished.
        const ready = !!generated[voice.id] || source === "cached" || source === "gallery";
        const generating = !ready && !!jobs[voice.id] && !jobs[voice.id].done;
        return <article key={voice.id} aria-label={voice.name} className={`${panelClass} flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-3">
            <VoiceAvatar voice={{ name: voice.name, hue: hueFor(voice.id) }} size={40} />
            <Button variant="ghost" className={cn("h-10 w-10 p-0", favorite && "text-accent")} aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${voice.name}`} aria-pressed={favorite} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => toggleFavorite(voice)}><Star size={20} fill={favorite ? "currentColor" : "none"} aria-hidden /></Button>
          </div>
          <h3 className="font-serif text-lg">{voice.name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-line px-2 py-0.5 text-xs font-medium text-fg2" aria-label="Voice source: VoiceStudio">VoiceStudio</span>
            <span className={cn("inline-flex items-center gap-1 text-xs", ready ? "text-accent" : "text-fg2")}>
              {ready && <CheckCircle2 size={14} aria-hidden />}
              {ready ? "Preview ready" : generating ? "Generating preview…" : source === "rendering" ? "Not generated" : source === "no_model" ? "Model required" : source ? "Preview status unavailable" : "Checking preview…"}
            </span>
          </div>
          <p className="text-xs uppercase tracking-wide text-fg3">{voice.use_case} · {voice.language}</p><p className="flex-1 text-sm text-fg2">{voice.instruct}</p>
          <div className="flex flex-wrap gap-2"><Button onClick={() => { op.setError(""); openPreview(voice.id, voice.name); }}>{ready && <Play size={14} aria-hidden />}{ready ? "Play preview" : "Preview"}</Button><Button disabled={op.busy || saved.has(voice.id)} onClick={() => void op.run(async (signal) => {
            const result = await studioJson<{ profile_id: string; name: string }>(`/archetypes/${idPath(voice.id)}/use`, { method: "POST", signal });
            setSaved((before) => new Set([...before, voice.id])); await useVoices.getState().load(); op.setStatus(`${result.name} added to Voices.`);
          })}>{saved.has(voice.id) ? "Added" : "Add to Voices"}</Button></div>
        </article>;
      })}
    </div>
    {!loading && count === 0 && !loadError && <p className="text-fg2">{favoritesOnly && !query.trim() ? "No favorites yet. Star a voice in All voices to keep it here." : "No voices match that search."}</p>}
    <div className="flex items-center gap-3"><Button disabled={currentPage === 0 || loading} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm text-fg2">Page {currentPage + 1}</span><Button disabled={(currentPage + 1) * PAGE_SIZE >= count || loading} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
  </div>;
}
