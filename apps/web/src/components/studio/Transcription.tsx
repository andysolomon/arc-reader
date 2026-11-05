import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@readaloud/ui";
import { transcribe, downloadText, subtitles, type Transcript } from "../../lib/studio";
import { useLibrary } from "../../state/library";
import { Field, Recorder, LocalAudio, ErrorNotice, fieldClass, panelClass, useOperation } from "./shared";

export function Transcription({ dictate }: { dictate: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Transcript | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const navigate = useNavigate();
  const op = useOperation();
  const recognize = (audio: File) => op.run(async (signal) => {
    op.setStatus("Transcribing…");
    const data = await transcribe(audio, dictate, signal);
    setResult(data); setText(data.text); setDirty(false);
    op.setStatus(data.text.trim() ? "Transcript ready." : "No speech detected. Try a clearer recording.");
  });
  const choose = (audio: File | null) => { setFile(audio); setResult(null); setText(""); setDirty(false); };
  return <div className={`${panelClass} flex flex-col gap-5`}>
    <div><h2 className="font-serif text-xl">{dictate ? "Dictate" : "Transcribe audio"}</h2><p className="mt-2 text-sm text-fg2">{dictate ? "Speak into your microphone, then stop to turn the recording into editable text. Everything is transcribed by your local VoiceStudio server." : "Turn an audio or video file into editable text and timed subtitles."}</p></div>
    {dictate ? <Recorder disabled={op.busy} onRecorded={(audio) => { choose(audio); void recognize(audio); }} /> : <Field label="Audio or video file"><input className={fieldClass} type="file" accept="audio/*,video/*" disabled={op.busy} onChange={(e) => choose(e.target.files?.[0] ?? null)} /></Field>}
    <LocalAudio file={file} />
    {file && <div className="flex flex-wrap gap-3"><Button variant="primary" loading={op.busy} onClick={() => void recognize(file)}>{result ? "Transcribe again" : "Transcribe"}</Button>{op.busy && <Button onClick={op.cancel}>Cancel</Button>}</div>}
    <p role="status" className="text-sm text-fg2">{op.status}</p><ErrorNotice error={op.error} />
    {result && <>
      <Field label="Transcript"><textarea className={fieldClass} rows={10} value={text} onChange={(e) => { setText(e.target.value); setDirty(true); }} /></Field>
      <div className="flex flex-wrap gap-3"><Button disabled={!text.trim() || op.busy} onClick={() => void op.run(async () => {
        await useLibrary.getState().create({ text, title: file?.name.replace(/\.[^.]+$/, "") || "Dictation", source: "file", domain: file?.name || "Microphone" });
        navigate("/library");
      })}>Save to Library</Button><Button disabled={!text.trim()} onClick={() => downloadText(text, "transcript.txt")}>Download text</Button>
      {!!result.segments?.length && <Button disabled={dirty} title={dirty ? "Subtitles use the original timed transcript. Transcribe again to reset edits." : undefined} onClick={() => downloadText(subtitles(result.segments!), "transcript.srt", "application/x-subrip")}>Download subtitles</Button>}</div>
      {dirty && !!result.segments?.length && <p className="text-xs text-fg2">Text edits do not update subtitle timings. Download text to keep your edits.</p>}
    </>}
  </div>;
}
