import { useEffect, useMemo, useRef, useState } from "react";
import { BookHeadphones, Check, FileArchive, FolderOpen, Trash2 } from "lucide-react";
import { Button, Dialog, ProgressBar, Segmented, cn } from "@readaloud/ui";
import { voiceIdOfKeyPart } from "../engine/voiceRevisions";
import { audioCache, type DocRecord } from "../lib/db";
import { backupSummary, buildBackup, importBackup, offloadKeys, openBackup, planImport, safeName, type BackupSummary, type ImportPlan, type OpenedBackup } from "../lib/audioBackup";
import { aacEncoding, audiobookChapters, audiobookVoices, makeAudiobook, type BookVoice } from "../lib/audiobook";
import { audioLimitFor } from "../lib/audioLimit";
import { saveFile, type Saved } from "../lib/saveFile";
import { deviceStorage, formatBytes } from "../lib/storage";
import { useLibrary } from "../state/library";
import { useSettings } from "../state/settings";
import { getVoice } from "../state/voices";
import { toast } from "../state/toast";

/** A voice's name from the engine and voice part of a cache key. */
export function voiceName(prefix: string): string {
  const id = voiceIdOfKeyPart(prefix.split("|")[1] ?? "");
  const voice = useLibrary.getState().items.flatMap((it) => it.prepared).find((v) => v.voiceId === id) ?? getVoice(id);
  return voice.name || id;
}

const plural = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
const aborted = (error: unknown) => (error as Error)?.name === "AbortError";

type Work = { done: number; total: number };
type Made = { file: File; saved?: Saved };

/** Hands a made file over, and says what happened to it. */
function SaveStep({ made, onSaved, label }: { made: Made; onSaved: (saved: Saved) => void; label: string }) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      onSaved(await saveFile(made.file));
    } catch (error) {
      toast(`Couldn’t save the file. ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-bg p-3">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <Check size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 truncate text-fg" title={made.file.name}>{made.file.name}</span>
        <span className="shrink-0 tabular-nums text-fg2">{formatBytes(made.file.size)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={made.saved === "shared" || made.saved === "downloaded" ? "secondary" : "primary"} loading={saving} onClick={() => void save()}>{made.saved && made.saved !== "cancelled" ? "Save again" : label}</Button>
        {made.saved === "shared" && <span className="text-[13px] text-fg2" role="status">Saved</span>}
        {made.saved === "downloaded" && <span className="text-[13px] text-fg2" role="status">Sent to your downloads</span>}
      </div>
    </div>
  );
}

/**
 * Save the audio a document, book or series has on this device: as a backup that loads back
 * into ReadAloud (and frees the space, once saved), or as an audiobook for other players.
 */
export function ExportAudioDialog({ title, author, album, documents, onClose }: { title: string; author?: string; album?: string; documents: DocRecord[]; onClose: () => void }) {
  const [tab, setTab] = useState<"backup" | "audiobook">("backup");
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [backup, setBackup] = useState<(Made & { keys: string[]; remove: string[]; freed: number }) | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<number | null>(null);
  const [voices, setVoices] = useState<BookVoice[] | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [aac, setAac] = useState<boolean | null>(null);
  const [book, setBook] = useState<(Made & { left: number }) | null>(null);
  const control = useRef<AbortController | null>(null);
  const library = useLibrary((s) => s.items);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [found, keys, encoding] = await Promise.all([backupSummary(documents, voiceName), audioCache.keys(), aacEncoding()]);
      if (!live) return;
      const complete = audiobookVoices(documents, new Set(keys), voiceName);
      setSummary(found);
      setVoices(complete);
      setVoice(complete[0]?.prefix ?? null);
      setAac(!!encoding);
    })().catch(() => { if (live) setSummary({ clips: 0, bytes: 0, voices: [] }); });
    return () => { live = false; control.current?.abort(); };
  }, [documents]);

  const close = () => { control.current?.abort(); onClose(); };
  const start = () => {
    control.current?.abort();
    control.current = new AbortController();
    setWork({ done: 0, total: 0 });
    return control.current.signal;
  };
  const cancel = () => { control.current?.abort(); setWork(null); };

  const makeBackup = async () => {
    const signal = start();
    try {
      const made = await buildBackup(documents, { title, voiceName, signal, onProgress: (done, total) => setWork({ done, total }) });
      const remove = offloadKeys(made.keys, documents, library.map((it) => it.rec));
      const sizes = await audioCache.sizes();
      setBackup({ file: new File([made.file], `${safeName(title)} · ReadAloud audio.zip`, { type: "application/zip" }), keys: made.keys, remove, freed: remove.reduce((n, key) => n + (sizes.get(key) ?? 0), 0) });
    } catch (error) {
      if (!aborted(error)) toast(`Couldn’t make the file. ${(error as Error).message}`);
    } finally {
      setWork(null);
    }
  };

  const makeBook = async () => {
    if (!voice) return;
    const signal = start();
    try {
      const { chapters, missing } = await audiobookChapters(documents, voice);
      const made = await makeAudiobook(chapters, { tags: { title, author, album }, signal, onProgress: (done, total) => setWork({ done, total }) });
      setBook({ file: new File([made.file], `${safeName(title)}.${made.extension}`, { type: made.file.type }), left: missing.length });
    } catch (error) {
      if (!aborted(error)) toast(`Couldn’t make the audiobook. ${(error as Error).message}`);
    } finally {
      setWork(null);
    }
  };

  const offload = async () => {
    if (!backup) return;
    setRemoving(true);
    try {
      await audioCache.remove(backup.remove);
      setRemoved(backup.freed);
      void useLibrary.getState().refresh();
      toast(`Removed ${formatBytes(backup.freed)} of audio from this device`);
    } catch {
      toast("Couldn’t remove the audio");
    } finally {
      setRemoving(false);
    }
  };

  const busy = !!work;
  const progress = work && (
    <div className="flex flex-col gap-1.5">
      <ProgressBar value={work.total ? work.done / work.total : null} label={tab === "backup" ? "Making the file" : "Making the audiobook"} />
      <div className="flex items-center justify-between gap-3 text-[12px] tabular-nums text-fg2">
        <span>{work.total ? `${work.done.toLocaleString()} of ${plural(work.total, "passage")}` : "Getting ready…"}</span>
        <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    </div>
  );
  const chosen = voices?.find((v) => v.prefix === voice);
  const savedSomewhere = backup?.saved === "shared" || backup?.saved === "downloaded";
  const nothing = summary !== null && summary.clips === 0;

  return (
    <Dialog open onClose={close} title="Save audio" initialFocus="dialog" className="max-h-[calc(100dvh-48px)] overflow-y-auto">
      <div className="min-w-0">
        <div className="truncate text-[15px] text-fg">{title}</div>
        <div className="text-[13px] text-fg2" role="status">
          {summary === null ? "Measuring the audio on this device…"
            : nothing ? "No audio is saved on this device for this yet."
            : `${formatBytes(summary.bytes)} on this device · ${summary.voices.map((v) => v.name).join(", ")}`}
        </div>
      </div>
      {nothing ? (
        <p className="m-0 text-sm text-fg2">Prepare audio first, then come back here to save it to a file.</p>
      ) : summary && (
        <>
          <Segmented label="What to save" value={tab} onChange={(next) => { if (!busy) setTab(next); }} options={[{ value: "backup", label: "Backup" }, { value: "audiobook", label: "Audiobook" }]} />
          {tab === "backup" ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-fg2">
                One file with every voice’s audio, to keep wherever you like. Load it back from Settings → Storage and it plays here again without being made or paid for twice. The MP3s inside also play in any player.
              </p>
              {progress}
              {!busy && !backup && <Button variant="primary" leading={<FileArchive size={15} />} onClick={() => void makeBackup()}>Make backup file · {plural(summary.clips, "passage")}</Button>}
              {!busy && backup && <SaveStep made={backup} label="Save file" onSaved={(saved) => setBackup((b) => b && { ...b, saved })} />}
              {!busy && backup && backup.remove.length > 0 && removed === null && (
                <div className={cn("flex flex-col gap-2 border-t border-line pt-3", !savedSomewhere && "opacity-60")}>
                  <p className="m-0 text-[13px] text-fg2">
                    {savedSomewhere
                      ? `Once the file is somewhere safe, free up ${formatBytes(backup.freed)} here. Your documents and your place in each stay.`
                      : "After saving the file, you can remove this audio from the device to free up space."}
                    {backup.remove.length < backup.keys.length ? " Passages other documents also read stay." : ""}
                  </p>
                  <Button variant="danger" className="self-start" leading={<Trash2 size={15} />} disabled={!savedSomewhere} loading={removing} onClick={() => void offload()}>Remove {formatBytes(backup.freed)} from this device</Button>
                </div>
              )}
              {removed !== null && <p className="m-0 text-[13px] text-fg2" role="status">Removed {formatBytes(removed)} from this device. Load the file in Settings → Storage to listen here again.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-fg2">
                {aac === false
                  ? "One MP3 with a chapter for each document, for podcast and audiobook players. This browser can’t make M4B files; Safari and the iPhone app can."
                  : "One M4B file with a chapter for each document, for Apple Books and other audiobook players. It can’t be loaded back into ReadAloud; use a backup for that."}
              </p>
              {voices && voices.length === 0 && <p className="m-0 text-sm text-fg2">No voice has a whole document saved on this device yet. Prepare it fully first.</p>}
              {voices && voices.length > 0 && (
                <div role="radiogroup" aria-label="Audiobook voice" className="flex flex-col gap-1 rounded-control border border-line p-1.5">
                  {voices.map((v) => (
                    <label key={v.prefix} className="flex cursor-pointer items-center gap-3 rounded-control p-2 hover:bg-bg3">
                      <input type="radio" name="audiobook-voice" className="size-4 shrink-0 accent-[var(--accent)]" checked={voice === v.prefix} disabled={busy} onChange={() => { setVoice(v.prefix); setBook(null); }} />
                      <span className="flex-1 text-sm text-fg">{v.name}</span>
                      <span className="text-[12px] tabular-nums text-fg2">{v.complete === v.total ? (v.total === 1 ? "Complete" : `All ${v.total}`) : `${v.complete} of ${v.total}`}</span>
                    </label>
                  ))}
                </div>
              )}
              {chosen && chosen.complete < chosen.total && !book && <p className="m-0 text-[12px] text-fg2">{plural(chosen.total - chosen.complete, "document")} not fully saved in {chosen.name} {chosen.total - chosen.complete === 1 ? "is" : "are"} left out.</p>}
              {aac && documents.length > 3 && !book && !busy && <p className="m-0 text-[12px] text-fg2">Making an M4B re-encodes the audio, which takes a few minutes for a long book. Keep this open.</p>}
              {progress}
              {!busy && !book && chosen && <Button variant="primary" leading={<BookHeadphones size={15} />} onClick={() => void makeBook()}>Make audiobook</Button>}
              {!busy && book && <SaveStep made={book} label="Save audiobook" onSaved={(saved) => setBook((b) => b && { ...b, saved })} />}
            </div>
          )}
        </>
      )}
      <div className="flex justify-end">
        <Button onClick={close}>{backup?.saved || book?.saved || removed !== null ? "Done" : "Close"}</Button>
      </div>
    </Dialog>
  );
}

/** Settings → Storage: load a backup's audio onto this device, and the documents the library is missing. */
export function ImportAudio() {
  const input = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<{ backup: OpenedBackup; plan: ImportPlan } | null>(null);
  const [reading, setReading] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const backup = await openBackup(file);
      setOpened({ backup, plan: await planImport(backup) });
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input ref={input} type="file" accept=".zip,application/zip" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => void choose(e.target.files?.[0])} />
      <Button loading={reading} leading={<FolderOpen size={15} />} onClick={() => input.current?.click()} className="bg-bg">Choose file</Button>
      {opened && <ImportDialog backup={opened.backup} plan={opened.plan} onClose={() => setOpened(null)} />}
    </>
  );
}

function ImportDialog({ backup, plan, onClose }: { backup: OpenedBackup; plan: ImportPlan; onClose: () => void }) {
  const [addDocuments, setAddDocuments] = useState(true);
  const [room, setRoom] = useState<{ used: number; limit: number } | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const control = useRef<AbortController | null>(null);
  const choice = useSettings((s) => s.audioLimit);
  const { manifest } = backup;
  const voices = useMemo(() => [...new Set(Object.values(manifest.voices))], [manifest]);

  useEffect(() => {
    let live = true;
    void Promise.all([audioCache.usage(), deviceStorage()]).then(([usage, storage]) => {
      if (live) setRoom({ used: usage.bytes, limit: audioLimitFor(storage.allowed, choice) });
    }).catch(() => {});
    return () => { live = false; control.current?.abort(); };
  }, [choice]);

  // Audio loaded counts against the amount this device keeps, like audio made here.
  const tooBig = !!room && plan.bytes > room.limit;
  const crowded = !!room && !tooBig && room.used + plan.bytes > room.limit;
  const nothingNew = plan.clips.length === 0 && plan.documents.length === 0;

  const load = async () => {
    control.current = new AbortController();
    setWork({ done: 0, total: plan.clips.length });
    try {
      const done = await importBackup(backup, plan, { documents: addDocuments, signal: control.current.signal, onProgress: (d, total) => setWork({ done: d, total }) });
      void useLibrary.getState().refresh();
      const parts = [
        done.clips ? `Loaded ${plural(done.clips, "passage")} · ${formatBytes(done.bytes)}` : "No new audio loaded",
        ...(done.documents ? [`added ${plural(done.documents, "document")}`] : []),
        ...(done.damaged ? [`${plural(done.damaged, "damaged passage")} skipped`] : []),
      ];
      toast(parts.join(" · "), 6000);
      onClose();
    } catch (error) {
      if (aborted(error)) toast("Stopped loading. The audio loaded so far stays.");
      else if ((error as Error)?.name === "QuotaExceededError") toast("This device ran out of space. The audio loaded so far stays.", 6000);
      else toast(`Couldn’t load the audio. ${(error as Error).message}`);
      void useLibrary.getState().refresh();
      setWork(null);
    }
  };

  return (
    <Dialog open onClose={() => { if (!work) onClose(); }} title="Load audio" initialFocus="dialog" className="max-h-[calc(100dvh-48px)] overflow-y-auto">
      <div className="min-w-0">
        <div className="truncate text-[15px] text-fg">{manifest.title}</div>
        <div className="text-[13px] text-fg2">
          {[voices.join(", "), plural(manifest.clips.length, "passage"), manifest.createdAt ? `saved ${new Date(manifest.createdAt).toLocaleDateString()}` : ""].filter(Boolean).join(" · ")}
        </div>
      </div>
      <dl className="m-0 divide-y divide-line border-y border-line text-[13px]">
        <div className="flex justify-between gap-3 py-2"><dt className="text-fg2">New to this device</dt><dd className="m-0 tabular-nums text-fg">{plural(plan.clips.length, "passage")} · {formatBytes(plan.bytes)}</dd></div>
        {plan.present > 0 && <div className="flex justify-between gap-3 py-2"><dt className="text-fg2">Already here</dt><dd className="m-0 tabular-nums text-fg">{plural(plan.present, "passage")}</dd></div>}
        {plan.known > 0 && <div className="flex justify-between gap-3 py-2"><dt className="text-fg2">In your library</dt><dd className="m-0 tabular-nums text-fg">{plural(plan.known, "document")}</dd></div>}
      </dl>
      {plan.documents.length > 0 && (
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" checked={addDocuments} disabled={!!work} onChange={(e) => setAddDocuments(e.target.checked)} />
          <span>Add the {plan.documents.length === 1 ? "document" : `${plan.documents.length} documents`} your library doesn’t have <span className="text-fg2">({plan.documents.slice(0, 2).map((d) => `“${d.title}”`).join(", ")}{plan.documents.length > 2 ? ", …" : ""})</span></span>
        </label>
      )}
      {tooBig && <p className="m-0 text-[13px] text-danger">This is more than the {formatBytes(room!.limit)} of audio this device keeps. Raise “Keep up to” above it first.</p>}
      {crowded && <p className="m-0 text-[13px] text-fg2">To stay under {formatBytes(room!.limit)}, about {formatBytes(room!.used + plan.bytes - room!.limit)} of the oldest audio on this device is removed.</p>}
      {nothingNew && <p className="m-0 text-[13px] text-fg2">Everything in this file is already on this device.</p>}
      {work && (
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={work.total ? work.done / work.total : null} label="Loading audio" />
          <div className="flex items-center justify-between gap-3 text-[12px] tabular-nums text-fg2">
            <span>{work.done.toLocaleString()} of {plural(work.total, "passage")}</span>
            <Button size="sm" variant="ghost" onClick={() => control.current?.abort()}>Stop</Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={!!work}>Cancel</Button>
        <Button variant="primary" disabled={!!work || tooBig || nothingNew || (plan.clips.length === 0 && !addDocuments)} onClick={() => void load()}>Load audio</Button>
      </div>
    </Dialog>
  );
}
