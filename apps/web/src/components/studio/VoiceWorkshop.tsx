import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, VoiceAvatar } from "@readaloud/ui";
import { useVoices } from "../../state/voices";
import { hueFor } from "../../data/voices";
import { studioJson, idPath, jsonBody, type Archetype, type Design, type Profile } from "../../lib/studio";
import { GalleryPreview } from "./GalleryPreview";
import { Field, ErrorNotice, Recorder, LocalAudio, fieldClass, panelClass, useOperation } from "./shared";

export function VoiceWorkshop({ mode }: { mode: "clone" | "design" }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [design, setDesign] = useState<Design | null>(null);
  const [saved, setSaved] = useState<Profile | null>(null);
  const op = useOperation();
  const save = () => op.run(async (signal) => {
    if (!name.trim()) throw new Error("Give your voice a name.");
    if (mode === "clone" && !file) throw new Error("Choose or record a reference clip.");
    if (mode === "design" && !design) throw new Error("Interpret your description first.");
    const body = new FormData();
    body.set("name", name.trim()); body.set("kind", mode); body.set("language", "Auto");
    body.set("ref_text", reference.trim());
    if (mode === "clone" && file) body.set("ref_audio", file);
    if (mode === "design" && design) { body.set("vd_states", JSON.stringify(design.attrs)); body.set("instruct", design.instruct); body.set("seed", "42"); }
    const result = await studioJson<Profile>("/profiles", { method: "POST", body, signal });
    setSaved(result); await useVoices.getState().load();
    op.setStatus(`${result.name} saved to Voices.`);
  });
  return <div className={`${panelClass} flex flex-col gap-5`}>
    <div><h2 className="font-serif text-xl">{mode === "clone" ? "Clone a voice" : "Design a voice"}</h2>
      <p className="mt-2 text-sm text-fg2">{mode === "clone" ? "Upload or record a clear, single-speaker sample. Around 10–20 seconds works well." : "Describe a voice, review the attributes VoiceStudio recognizes, then save it for reading and dubbing."}</p></div>
    <Field label="Voice name"><input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="My narrator" /></Field>
    {mode === "clone" ? <>
      <Field label="Reference audio or video"><input className={fieldClass} type="file" accept="audio/*,video/*" disabled={op.busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSaved(null); }} /></Field>
      <Recorder disabled={op.busy} onRecorded={setFile} />
      {file && <p className="text-sm text-fg2">{file.name}</p>}
      <LocalAudio file={file} />
      <Field label="Words spoken in the sample (optional)"><textarea className={fieldClass} rows={3} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Leave blank to transcribe automatically." /></Field>
    </> : <>
      <Field label="Describe your voice"><textarea className={fieldClass} rows={4} maxLength={2000} value={description} onChange={(e) => { setDescription(e.target.value); setDesign(null); setSaved(null); }} placeholder="A middle-aged British woman with a low pitch, speaking softly." /></Field>
      <Button className="self-start" disabled={!description.trim()} loading={op.busy} onClick={() => void op.run(async (signal) => { setDesign(await studioJson<Design>("/design/describe", { ...jsonBody({ description }), signal })); })}>Interpret description</Button>
      {design && <div className="rounded-control bg-bg3 p-4 text-sm"><p>{design.instruct || "Neutral voice (automatic attributes)"}</p>{design.unmatched.length > 0 && <p className="mt-2 text-fg2">Not supported by this model: {design.unmatched.join(", ")}</p>}</div>}
    </>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!name.trim() || (mode === "clone" ? !file : !design)} loading={op.busy} onClick={() => void save()}>Save voice</Button>{saved && <Link className="text-sm underline" to="/voices">Choose {saved.name} in Voices</Link>}</div>
    <p role="status" className="text-sm text-fg2">{op.status}</p><ErrorNotice error={op.error} />
  </div>;
}

export function VoiceGallery() {
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState(true);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Archetype[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const op = useOperation();
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true); setLoadError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, limit: "24", offset: String(page * 24) });
      if (featured) params.set("featured", "true");
      void studioJson<{ items: Archetype[]; total: number }>(`/archetypes?${params}`, { signal: ac.signal })
        .then((data) => { setItems(data.items); setTotal(data.total); })
        .catch((e: Error) => { if (!ac.signal.aborted) setLoadError(e.message); })
        .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [query, featured, page]);
  return <div className="flex flex-col gap-5">
    <div><h2 className="font-serif text-xl">Designed voice gallery</h2><p className="mt-2 text-sm text-fg2">VoiceStudio’s original catalog. Preview a character or add its recipe to your saved voices.</p></div>
    <div className="flex flex-wrap items-end gap-4"><div className="min-w-0 flex-1"><Field label="Search designed voices"><input className={fieldClass} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Narrator, British, whisper…" /></Field></div><label className="flex items-center gap-2 py-3 text-sm"><input type="checkbox" checked={featured} onChange={(e) => { setFeatured(e.target.checked); setPage(0); }} />Featured only</label></div>
    {preview && <GalleryPreview key={preview.id} id={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
    <p role="status" className="text-sm text-fg2">{loading ? "Loading gallery…" : `${total} voices`}{op.status && ` · ${op.status}`}</p>
    <ErrorNotice error={loadError || op.error} />
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {items.map((voice) => <article key={voice.id} className={`${panelClass} flex flex-col gap-3`}>
        <VoiceAvatar voice={{ name: voice.name, hue: hueFor(voice.id) }} size={40} />
        <h3 className="font-serif text-lg">{voice.name}</h3><p className="text-xs uppercase tracking-wide text-fg3">{voice.use_case} · {voice.language}</p><p className="flex-1 text-sm text-fg2">{voice.instruct}</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => { op.setError(""); setPreview({ id: voice.id, name: voice.name }); }}>Preview</Button><Button disabled={op.busy || saved.has(voice.id)} onClick={() => void op.run(async (signal) => {
          const result = await studioJson<{ profile_id: string; name: string }>(`/archetypes/${idPath(voice.id)}/use`, { method: "POST", signal });
          setSaved((before) => new Set([...before, voice.id])); await useVoices.getState().load(); op.setStatus(`${result.name} added to Voices.`);
        })}>{saved.has(voice.id) ? "Added" : "Add to Voices"}</Button></div>
      </article>)}
    </div>
    {!loading && total === 0 && !loadError && <p className="text-fg2">No voices match that search.</p>}
    <div className="flex items-center gap-3"><Button disabled={page === 0 || loading} onClick={() => setPage((n) => n - 1)}>Previous</Button><span className="text-sm text-fg2">Page {page + 1}</span><Button disabled={(page + 1) * 24 >= total || loading} onClick={() => setPage((n) => n + 1)}>Next</Button></div>
  </div>;
}
