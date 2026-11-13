import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@readaloud/ui";
import { useVoices } from "../../state/voices";
import { studioJson, jsonBody, type Design, type Profile } from "../../lib/studio";
import { Field, ErrorNotice, Recorder, LocalAudio, SavedVoiceAvatar, fieldClass, panelClass, useOperation } from "./shared";

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
    <Field label="Voice name"><input className={fieldClass} value={name} onChange={(e) => { setName(e.target.value); setSaved(null); }} maxLength={100} placeholder="My narrator" /></Field>
    {mode === "clone" ? <>
      <Field label="Reference audio or video"><input className={fieldClass} type="file" accept="audio/*,video/*" disabled={op.busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSaved(null); }} /></Field>
      <Recorder disabled={op.busy} onRecorded={(audio) => { setFile(audio); setSaved(null); }} />
      {file && <p className="text-sm text-fg2">{file.name}</p>}
      <LocalAudio file={file} />
      <Field label="Words spoken in the sample (optional)"><textarea className={fieldClass} rows={3} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Leave blank to transcribe automatically." /></Field>
    </> : <>
      <Field label="Describe your voice"><textarea className={fieldClass} rows={4} maxLength={2000} value={description} onChange={(e) => { setDescription(e.target.value); setDesign(null); setSaved(null); }} placeholder="A middle-aged British woman with a low pitch, speaking softly." /></Field>
      <Button className="self-start" disabled={!description.trim()} loading={op.busy} onClick={() => void op.run(async (signal) => { setDesign(await studioJson<Design>("/design/describe", { ...jsonBody({ description }), signal })); setSaved(null); })}>Interpret description</Button>
      {design && <div className="rounded-control bg-bg3 p-4 text-sm"><p>{design.instruct || "Neutral voice (automatic attributes)"}</p>{design.unmatched.length > 0 && <p className="mt-2 text-fg2">Not supported by this model: {design.unmatched.join(", ")}</p>}</div>}
    </>}
    {/* Saving is final until something changes: a second press would create a duplicate voice on the server. */}
    <div className="flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!!saved || !name.trim() || (mode === "clone" ? !file : !design)} loading={op.busy} onClick={() => void save()}>{saved ? "Saved" : "Save voice"}</Button>{saved && <span className="inline-flex items-center gap-2.5"><SavedVoiceAvatar id={saved.id} size={36} /><Link className="text-sm underline" to="/voices">Choose {saved.name} in Voices</Link></span>}</div>
    <p role="status" className="text-sm text-fg2">{op.status}</p><ErrorNotice error={op.error} />
  </div>;
}
