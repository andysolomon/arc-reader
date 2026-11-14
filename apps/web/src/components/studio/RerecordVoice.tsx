import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@readaloud/ui";
import { useVoices } from "../../state/voices";
import { idPath, studioJson, type Profile } from "../../lib/studio";
import { Field, ErrorNotice, Recorder, LocalAudio, SavedVoiceAvatar, fieldClass, panelClass, useOperation } from "./shared";
import { ReadingScriptCard, ScriptedReferenceNote, useScriptedReference } from "./ReadingScript";

/** Replace a saved clone's reference recording. The voice keeps its id, so documents set to it keep it. */
export function RerecordVoice({ id }: { id: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [saved, setSaved] = useState(false);
  const scripted = useScriptedReference(reference, setReference);
  const op = useOperation();

  useEffect(() => {
    const ac = new AbortController();
    studioJson<Profile>(`/profiles/${idPath(id)}`, { signal: ac.signal }).then((p) => {
      setProfile(p); setName(p.name);
    }).catch((e: Error) => { if (!ac.signal.aborted) setLoadError(e.message); });
    return () => ac.abort();
  }, [id]);

  const save = () => op.run(async () => {
    if (!file) throw new Error("Choose or record a new reference clip.");
    if (!name.trim()) throw new Error("Give your voice a name.");
    const result = await useVoices.getState().rerecord(id, file, reference, name.trim() === profile?.name ? undefined : name);
    setProfile(result); setSaved(true);
    op.setStatus(`${result.name} now speaks with the new recording.`);
  });
  const changed = () => setSaved(false);

  if (loadError) return <div className={`${panelClass} flex flex-col gap-3`}><h2 className="font-serif text-xl">Re-record a voice</h2><ErrorNotice error={loadError} /><Link className="text-sm underline" to="/voices">Back to Voices</Link></div>;
  if (!profile) return <div className={panelClass}><p role="status" className="text-sm text-fg2">Loading voice…</p></div>;
  if ((profile.kind ?? "clone") !== "clone") {
    return <div className={`${panelClass} flex flex-col gap-3`}><h2 className="font-serif text-xl">Re-record {profile.name}</h2>
      <p className="text-sm text-fg2">{profile.name} is a designed voice: it comes from a description, not a recording, so there is nothing to re-record.</p>
      <Link className="text-sm underline" to="/voices">Back to Voices</Link></div>;
  }
  return <div className={`${panelClass} flex flex-col gap-5`}>
    <div><div className="flex items-center gap-3"><SavedVoiceAvatar id={id} /><h2 className="font-serif text-xl">Re-record {profile.name}</h2></div>
      <p className="mt-3 text-sm text-fg2">Record yourself reading the passage below, or upload a new clear, single-speaker sample. It replaces the current one; documents set to {profile.name} keep the voice and use the new recording. Audio prepared with the old recording is no longer used.</p></div>
    <Field label="Voice name"><input className={fieldClass} value={name} onChange={(e) => { setName(e.target.value); changed(); }} maxLength={100} /></Field>
    <ReadingScriptCard onScript={scripted.onScript} />
    <Recorder disabled={op.busy} onRecorded={(audio) => { setFile(audio); changed(); scripted.recorded(); }} />
    <Field label="New reference audio"><input className={fieldClass} type="file" accept="audio/*" disabled={op.busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); changed(); scripted.uploaded(); }} /></Field>
    {file && <p className="text-sm text-fg2">{file.name}</p>}
    <LocalAudio file={file} />
    <Field label="Words spoken in the sample (optional)"><textarea className={fieldClass} rows={3} value={reference} onChange={(e) => { setReference(e.target.value); changed(); }} placeholder="Leave blank to transcribe automatically." /></Field>
    <ScriptedReferenceNote show={scripted.fromScript} />
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={saved || !file || !name.trim()} loading={op.busy} onClick={() => void save()}>{saved ? "Saved" : "Replace recording"}</Button>
      <Link className="text-sm underline" to="/voices">{saved ? `Back to ${profile.name} in Voices` : "Cancel"}</Link>
    </div>
    <p role="status" className="text-sm text-fg2">{op.status}</p><ErrorNotice error={op.error} />
  </div>;
}
