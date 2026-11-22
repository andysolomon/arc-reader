import { audioCache, docs, type AudioRecord, type DocRecord, type WordTiming } from "./db";
import { planReading } from "./prepared";
import { catalogue } from "./postTitle";
import { crc32, readZip, zipEntry, ZipWriter, type ZipEntry } from "./zip";

/**
 * Audio saved on this device, written to a file to keep anywhere and loaded back later.
 *
 * Clips are saved under `engine|voice|hash(text)`, so a clip carries everything needed to find
 * it again: loading one back is putting it under its key, and playback picks it up as though it
 * had never left. A clip whose text, voice recording or passage boundaries have changed since
 * simply matches nothing, and that passage is made again.
 *
 * The file is a ZIP: the clips as the MP3 or WebM files they were saved as, which play in most players, in folders by voice and
 * chapter, and readaloud.json with what playback needs to use them again (word timings,
 * sentence starts, silences, loudness) and the documents themselves.
 */

export const BACKUP_FORMAT = "readaloud-audio";
export const BACKUP_VERSION = 1;
export const MANIFEST = "readaloud.json";

export interface BackupClip {
  key: string;
  /** Where the clip's audio is inside the archive */
  path: string;
  mime: string;
  bytes: number;
  duration: number;
  words?: WordTiming[];
  starts?: number[];
  lead?: number;
  tail?: number;
  loudness?: number;
  voiced?: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  title: string;
  /** The documents the audio reads, so loading the file can bring back ones no longer in the library */
  documents: DocRecord[];
  /** Voice names by key prefix, for people reading the archive */
  voices: Record<string, string>;
  clips: BackupClip[];
}

const KEY = /^[^|\n]{1,200}\|[^|\n]{1,300}\|[0-9a-f]{8}$/;
/** The engine and voice part of a cache key, up to and including the separator before the text hash. */
export const prefixOf = (key: string) => key.slice(0, key.lastIndexOf("|") + 1);
const suffixOf = (key: string) => key.slice(key.lastIndexOf("|") + 1);

/** Every text hash a document's clips can end in: its passages and sentences, as written and as adapted. */
export function textHashes(rec: DocRecord): Set<string> {
  const plan = planReading(rec);
  const out = new Set<string>();
  for (const reading of [plan.original, plan.adapted]) {
    if (!reading) continue;
    for (const h of reading.passageHashes) out.add(h);
    for (const h of reading.sentenceHashes) out.add(h);
  }
  return out;
}

/** A name that is safe as one folder or file name on any system. */
export function safeName(text: string, max = 80): string {
  const clean = text.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  const cut = clean.length > max ? clean.slice(0, max).trim() : clean;
  return cut || "Untitled";
}

const pad = (n: number, width = 4) => String(n).padStart(width, "0");
const extension = (mime: string) => mime.includes("webm") ? "webm" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("aac") ? "m4a" : "audio";

export interface PlannedClip { key: string; docId: string; /** Path without its extension, which follows the clip's type */ path: string }

/**
 * The saved clips that read these documents, in reading order: each document's passages, and
 * any older sentence-by-sentence clips, in every voice. A clip several documents share is listed once.
 */
export function backupPlan(recs: DocRecord[], keys: Iterable<string>, voiceName: (prefix: string) => string): PlannedClip[] {
  const bySuffix = new Map<string, string[]>();
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const suffix = suffixOf(key);
    const list = bySuffix.get(suffix);
    if (list) list.push(key); else bySuffix.set(suffix, [key]);
  }
  const seen = new Set<string>();
  const paths = new Set<string>();
  const folders = new Set<string>();
  const out: PlannedClip[] = [];
  for (const rec of recs) {
    const plan = planReading(rec);
    const base = safeName(`${rec.book ? `${pad(rec.book.chapter, 3)} ` : ""}${catalogue(rec).title}`, 60);
    let folder = base;
    for (let n = 2; folders.has(folder); n++) folder = `${base} (${n})`;
    folders.add(folder);
    const add = (hash: string, name: string) => {
      for (const key of bySuffix.get(hash) ?? []) {
        if (seen.has(key)) continue;
        seen.add(key);
        let path = `audio/${safeName(voiceName(prefixOf(key)), 60)}/${folder}/${name}`;
        for (let n = 2; paths.has(path); n++) path = `audio/${safeName(voiceName(prefixOf(key)), 60)}/${folder}/${name} (${n})`;
        paths.add(path);
        out.push({ key, docId: rec.id, path });
      }
    };
    for (const reading of [plan.original, plan.adapted]) {
      if (!reading) continue;
      reading.passages.forEach((passage, i) => {
        add(reading.passageHashes[i], pad(i + 1));
        for (let s = passage.start; s < Math.min(passage.end, reading.sentences.length); s++) add(reading.sentenceHashes[s], `${pad(i + 1)}-${s - passage.start + 1}`);
      });
    }
  }
  return out;
}

export interface BackupVoice { prefix: string; name: string; clips: number; bytes: number }
export interface BackupSummary { clips: number; bytes: number; voices: BackupVoice[] }

/** What a backup of these documents would hold: clips and bytes saved on this device, by voice. */
export async function backupSummary(recs: DocRecord[], voiceName: (prefix: string) => string): Promise<BackupSummary> {
  const sizes = await audioCache.sizes();
  const voices = new Map<string, BackupVoice>();
  let clips = 0, bytes = 0;
  for (const { key } of backupPlan(recs, sizes.keys(), voiceName)) {
    const size = sizes.get(key) ?? 0;
    const prefix = prefixOf(key);
    const voice = voices.get(prefix) ?? voices.set(prefix, { prefix, name: voiceName(prefix), clips: 0, bytes: 0 }).get(prefix)!;
    voice.clips++;
    voice.bytes += size;
    clips++;
    bytes += size;
  }
  return { clips, bytes, voices: [...voices.values()].sort((a, b) => b.bytes - a.bytes) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const encoder = new TextEncoder();

const README = (title: string) => `Audio from ReadAloud: ${title}

The clips in audio/ play in most audio players (WebM files in VLC or a web browser). Each voice has a folder, each chapter or document a
folder inside it, and the files play in order by name.

To put the audio back in ReadAloud, open Settings > Storage > Load audio from a file, and choose
this file. Audio is matched to documents by their text, so anything that changed since is made again.
`;

export interface Backup {
  file: Blob;
  /** The clips written, by key */
  keys: string[];
  bytes: number;
}

/**
 * Write the audio saved for these documents to an archive. Every clip is read back from the
 * device as it is written, so one that can't be read fails here rather than after it was removed.
 */
export async function buildBackup(recs: DocRecord[], opts: { title: string; voiceName: (prefix: string) => string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<Backup> {
  const plan = backupPlan(recs, await audioCache.keys(), opts.voiceName);
  const zip = new ZipWriter();
  const clips: BackupClip[] = [];
  const voices: Record<string, string> = {};
  let bytes = 0;
  await zip.add("README.txt", encoder.encode(README(opts.title)));
  for (let i = 0; i < plan.length; i++) {
    opts.signal?.throwIfAborted();
    const { key, path } = plan[i];
    const rec = await audioCache.get(key);
    // Removed to make room since the plan was made.
    if (rec?.blob) {
      const mime = rec.mime || rec.blob.type || "audio/mpeg";
      const file = `${path}.${extension(mime)}`;
      await zip.add(file, rec.blob);
      clips.push(clipOf(rec, file, mime));
      voices[prefixOf(key)] = opts.voiceName(prefixOf(key));
      bytes += rec.blob.size;
    }
    opts.onProgress?.(i + 1, plan.length);
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: Date.now(), title: opts.title, documents: recs, voices, clips };
  await zip.add(MANIFEST, encoder.encode(JSON.stringify(manifest)));
  return { file: zip.finish(), keys: clips.map((c) => c.key), bytes };
}

function clipOf(rec: AudioRecord, path: string, mime: string): BackupClip {
  return {
    key: rec.key, path, mime, bytes: rec.blob.size, duration: round(rec.duration),
    ...(rec.words?.length ? { words: rec.words.map((w) => ({ start: round(w.start), end: round(w.end) })) } : {}),
    ...(rec.starts?.length ? { starts: rec.starts.map(round) } : {}),
    ...(rec.lead !== undefined ? { lead: round(rec.lead) } : {}),
    ...(rec.tail !== undefined ? { tail: round(rec.tail) } : {}),
    ...(rec.loudness !== undefined ? { loudness: round(rec.loudness) } : {}),
    ...(rec.voiced !== undefined ? { voiced: round(rec.voiced) } : {}),
  };
}

/**
 * The clips that can leave this device with these documents: those no other document in the
 * library reads too, such as a notice every chapter of another book repeats.
 */
export function offloadKeys(keys: string[], exported: DocRecord[], library: DocRecord[]): string[] {
  const ids = new Set(exported.map((rec) => rec.id));
  const others = new Set<string>();
  for (const rec of library) if (!ids.has(rec.id)) for (const h of textHashes(rec)) others.add(h);
  return keys.filter((key) => !others.has(suffixOf(key)));
}

// ---- loading a file back ----

export const NOT_A_BACKUP = "This isn't a ReadAloud audio file.";

export interface OpenedBackup {
  file: Blob;
  manifest: BackupManifest;
  entries: Map<string, ZipEntry>;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const optionalNumber = (n: unknown) => finite(n) ? n : undefined;

function parseClip(raw: unknown): BackupClip | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.key !== "string" || !KEY.test(c.key) || typeof c.path !== "string" || !finite(c.duration) || c.duration <= 0) return null;
  const mime = typeof c.mime === "string" && /^audio\/[\w.+-]+$/.test(c.mime) ? c.mime : "audio/mpeg";
  const words = Array.isArray(c.words) && c.words.every((w) => w && finite((w as WordTiming).start) && finite((w as WordTiming).end)) ? (c.words as WordTiming[]).map(({ start, end }) => ({ start, end })) : undefined;
  const starts = Array.isArray(c.starts) && c.starts.every(finite) ? c.starts as number[] : undefined;
  const clip: BackupClip = { key: c.key, path: c.path, mime, bytes: finite(c.bytes) ? c.bytes : 0, duration: c.duration };
  if (words) clip.words = words;
  if (starts) clip.starts = starts;
  for (const field of ["lead", "tail", "loudness", "voiced"] as const) {
    const value = optionalNumber(c[field]);
    if (value !== undefined) clip[field] = value;
  }
  return clip;
}

/** A document from the file, when it has what the library needs to list and read it. */
function parseDocument(raw: unknown): DocRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const ok = typeof d.id === "string" && d.id.length > 0 && d.id.length <= 200 && typeof d.title === "string" && typeof d.text === "string"
    && typeof d.domain === "string" && typeof d.source === "string" && (d.voice === null || typeof d.voice === "string")
    && finite(d.chars) && finite(d.createdAt) && finite(d.updatedAt);
  return ok ? raw as DocRecord : null;
}

export function parseManifest(raw: unknown): BackupManifest {
  const m = raw as Partial<BackupManifest> | null;
  if (!m || typeof m !== "object" || m.format !== BACKUP_FORMAT || !finite(m.version) || !Array.isArray(m.clips)) throw new Error(NOT_A_BACKUP);
  if (m.version > BACKUP_VERSION) throw new Error("This audio file was made by a newer version of ReadAloud. Update the app and try again.");
  return {
    format: BACKUP_FORMAT,
    version: m.version,
    createdAt: finite(m.createdAt) ? m.createdAt : 0,
    title: typeof m.title === "string" ? m.title : "Audio",
    documents: Array.isArray(m.documents) ? m.documents.map(parseDocument).filter((d): d is DocRecord => !!d) : [],
    voices: m.voices && typeof m.voices === "object" ? Object.fromEntries(Object.entries(m.voices).filter(([, v]) => typeof v === "string")) as Record<string, string> : {},
    clips: m.clips.map(parseClip).filter((c): c is BackupClip => !!c),
  };
}

export async function openBackup(file: Blob): Promise<OpenedBackup> {
  let entries: ZipEntry[];
  try {
    entries = await readZip(file);
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  const manifest = entries.find((entry) => entry.name === MANIFEST);
  if (!manifest) throw new Error(NOT_A_BACKUP);
  let raw: unknown;
  try {
    raw = JSON.parse(await (await zipEntry(file, manifest)).text());
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  return { file, manifest: parseManifest(raw), entries: new Map(entries.map((entry) => [entry.name, entry])) };
}

export interface ImportPlan {
  /** Clips this device doesn't have yet */
  clips: BackupClip[];
  bytes: number;
  /** Clips already saved here */
  present: number;
  /** Documents in the file that the library doesn't have */
  documents: DocRecord[];
  /** Documents in the file that the library has */
  known: number;
}

export async function planImport(backup: OpenedBackup): Promise<ImportPlan> {
  const [keys, library] = await Promise.all([audioCache.keys(), docs.all()]);
  const saved = new Set(keys);
  const ids = new Set(library.map((rec) => rec.id));
  const clips = backup.manifest.clips.filter((clip) => !saved.has(clip.key) && backup.entries.has(clip.path));
  const documents = backup.manifest.documents.filter((rec) => !ids.has(rec.id));
  return {
    clips,
    bytes: clips.reduce((sum, clip) => sum + (backup.entries.get(clip.path)?.length ?? clip.bytes), 0),
    present: backup.manifest.clips.length - clips.length,
    documents,
    known: backup.manifest.documents.length - documents.length,
  };
}

/** Clips are saved this many at a time: few enough to hold in memory, enough to be quick. */
const BATCH = 24;

export interface Imported { clips: number; bytes: number; documents: number; damaged: number }

/**
 * Load a file's audio onto this device, and the documents the library is missing when asked.
 * A clip whose bytes don't match their checksum is skipped and counted as damaged.
 */
export async function importBackup(backup: OpenedBackup, plan: ImportPlan, opts: { documents: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<Imported> {
  let documents = 0;
  if (opts.documents) {
    for (const rec of plan.documents) {
      opts.signal?.throwIfAborted();
      await docs.put(rec);
      documents++;
    }
  }
  let clips = 0, bytes = 0, damaged = 0;
  let batch: AudioRecord[] = [];
  const flush = async () => {
    await audioCache.putMany(batch);
    clips += batch.length;
    batch = [];
  };
  const now = Date.now();
  for (let i = 0; i < plan.clips.length; i++) {
    opts.signal?.throwIfAborted();
    const clip = plan.clips[i];
    const entry = backup.entries.get(clip.path)!;
    // Copied out of the chosen file, which the system may take back once the import ends.
    const data = new Uint8Array(await (await zipEntry(backup.file, entry)).arrayBuffer());
    if (crc32(data) !== entry.crc || !data.length) {
      damaged++;
    } else {
      const { path: _, bytes: __, ...fields } = clip;
      // Loaded now, so it is kept like audio made now rather than removed first to make room.
      batch.push({ ...fields, blob: new Blob([data], { type: clip.mime }), createdAt: now });
      bytes += data.length;
    }
    if (batch.length >= BATCH) await flush();
    opts.onProgress?.(i + 1, plan.clips.length);
  }
  await flush();
  return { clips, bytes, documents, damaged };
}
