import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@readaloud/ui";
import { useVoices } from "../../state/voices";
import { studioJson, jsonBody, type Design, type Profile } from "../../lib/studio";
import { DESIGN_SETTINGS, explainDesign, type DesignExplanation } from "../../lib/voiceDesign";
import { Field, ErrorNotice, Recorder, LocalAudio, SavedVoiceAvatar, fieldClass, panelClass, useOperation } from "./shared";
import { ReadingScriptCard, ScriptedReferenceNote, useScriptedReference } from "./ReadingScript";

export function VoiceWorkshop({ mode }: { mode: "clone" | "design" }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [design, setDesign] = useState<{ result: Design; explanation: DesignExplanation } | null>(null);
  const [saved, setSaved] = useState<Profile | null>(null);
  const scripted = useScriptedReference(reference, setReference);
  const op = useOperation();
  const save = () => op.run(async (signal) => {
    if (!name.trim()) throw new Error("Give your voice a name.");
    if (mode === "clone" && !file) throw new Error("Choose or record a reference clip.");
    if (mode === "design" && !design) throw new Error("Interpret your description first.");
    const body = new FormData();
    body.set("name", name.trim()); body.set("kind", mode); body.set("language", "Auto");
    body.set("ref_text", reference.trim());
    if (mode === "clone" && file) body.set("ref_audio", file);
    if (mode === "design" && design) { body.set("vd_states", JSON.stringify(design.result.attrs)); body.set("instruct", design.result.instruct); body.set("seed", "42"); }
    const result = await studioJson<Profile>("/profiles", { method: "POST", body, signal });
    setSaved(result); await useVoices.getState().load();
    op.setStatus(`${result.name} saved to Voices.`);
  });
  return <div className={`${panelClass} flex flex-col gap-5`}>
    <div><h2 className="font-serif text-xl">{mode === "clone" ? "Clone a voice" : "Design a voice"}</h2>
      <p className="mt-2 text-sm text-fg2">{mode === "clone" ? "Record yourself reading the passage below, or upload a clear, single-speaker sample. Around 10–20 seconds works well." : "Describe a voice, review the attributes VoiceStudio recognizes, then save it for reading and dubbing."}</p></div>
    <Field label="Voice name"><input className={fieldClass} value={name} onChange={(e) => { setName(e.target.value); setSaved(null); }} maxLength={100} placeholder="My narrator" /></Field>
    {mode === "clone" ? <>
      <ReadingScriptCard onScript={scripted.onScript} />
      <Recorder disabled={op.busy} onRecorded={(audio) => { setFile(audio); setSaved(null); scripted.recorded(); }} />
      <Field label="Reference audio or video"><input className={fieldClass} type="file" accept="audio/*,video/*" disabled={op.busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSaved(null); scripted.uploaded(); }} /></Field>
      {file && <p className="text-sm text-fg2">{file.name}</p>}
      <LocalAudio file={file} />
      <Field label="Words spoken in the sample (optional)"><textarea className={fieldClass} rows={3} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Leave blank to transcribe automatically." /></Field>
      <ScriptedReferenceNote show={scripted.fromScript} />
    </> : <>
      <Field label="Describe your voice"><textarea className={fieldClass} rows={4} maxLength={2000} value={description} onChange={(e) => { setDescription(e.target.value); setDesign(null); setSaved(null); }} placeholder="A middle-aged British woman with a low pitch." /></Field>
      <Button className="self-start" disabled={!description.trim()} loading={op.busy} onClick={() => void op.run(async (signal) => {
        const describe = (text: string) => studioJson<Design>("/design/describe", { ...jsonBody({ description: text }), signal });
        const result = await describe(description);
        setDesign({ result, explanation: await explainDesign(description, result, describe) }); setSaved(null);
      })}>Interpret description</Button>
      {design && <DesignSummary design={design.result} explanation={design.explanation} />}
    </>}
    {/* Saving is final until something changes: a second press would create a duplicate voice on the server. */}
    <div className="flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!!saved || !name.trim() || (mode === "clone" ? !file : !design)} loading={op.busy} onClick={() => void save()}>{saved ? "Saved" : "Save voice"}</Button>{saved && <span className="inline-flex items-center gap-2.5"><SavedVoiceAvatar id={saved.id} size={36} /><Link className="text-sm underline" to="/voices">Choose {saved.name} in Voices</Link></span>}</div>
    <p role="status" className="text-sm text-fg2">{op.status}</p><ErrorNotice error={op.error} />
  </div>;
}

const sentenceCase = (token: string) => token.charAt(0).toUpperCase() + token.slice(1);
const quoted = (phrases: string[]) => phrases.map((p) => `“${p}”`).join(", ");

/** All six settings the model accepts, flagging the ones left to chance, then everything it can't express. */
function DesignSummary({ design, explanation }: { design: Design; explanation: DesignExplanation }) {
  return <section aria-label="How VoiceStudio read your description" className="rounded-control bg-bg3 p-4 text-sm">
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      {DESIGN_SETTINGS.map((setting) => {
        const value = design.attrs[setting.key];
        const set = !!value && value !== "Auto";
        const heard = explanation.heard[setting.key] ?? [];
        return <div key={setting.key} className="contents">
          <dt className="text-fg2">{setting.label}</dt>
          <dd>{set
            ? <>{sentenceCase(value)}{heard.length > 0 && <span className="text-fg2"> · from {quoted(heard)}</span>}</>
            : setting.hint
              ? <><span className="text-accent">Not set, so the model picks.</span> <span className="text-fg2">{setting.hint}</span></>
              : <span className="text-fg2">{"unset" in setting ? setting.unset : "Auto"}</span>}
          </dd>
        </div>;
      })}
    </dl>
    {explanation.ignored.length > 0 && <div className="mt-4 border-t border-line pt-3">
      <p>Ignored: {quoted(explanation.ignored)}</p>
      <p className="mt-1 text-fg2">Designed voices can only use the settings above. To capture a delivery or personality, <Link className="underline" to="/studio/clone">clone a recording</Link> of it instead.</p>
    </div>}
  </section>;
}
