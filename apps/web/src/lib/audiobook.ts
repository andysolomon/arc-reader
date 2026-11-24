import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { voiceIdOfKeyPart } from "../engine/voiceRevisions";
import { audioCache, type AudioRecord, type DocRecord } from "./db";
import { planReading } from "./prepared";
import { catalogue } from "./postTitle";
import { muxM4b, aacConfig, audioSpecificConfig, type BookTags, type Chapter } from "./mp4";
import { id3Chapters, mp3Audio, type Mp3Chapter } from "./mp3";
import { joinWebmOpus } from "./webmOpus";

/**
 * One voice's saved audio for a document, a book or a series, as a single audiobook file with a
 * chapter per document. Where the browser can encode AAC (Safari, the iPhone app, Chrome on Mac
 * and Windows) it is an M4B. Elsewhere the clips are joined as they are: MP3 with ID3 chapters, or
 * Opus clips as one WebM, which has no chapter list.
 */

export interface BookChapter { rec: DocRecord; title: string; clips: AudioRecord[] }

export interface BookVoice {
  prefix: string;
  name: string;
  /** Documents with every passage saved in this voice */
  complete: number;
  total: number;
}

const voiceOf = (prefix: string) => voiceIdOfKeyPart(prefix.split("|")[1] ?? "");

/** The keys that read a document start to finish in one voice, or null when some passage isn't saved. */
function readingKeys(rec: DocRecord, prefix: string, has: (key: string) => boolean): string[] | null {
  const plan = planReading(rec);
  const reading = voiceOf(prefix) === JAMAICAN_PATOIS_VOICE_ID ? plan.adapted : plan.original;
  if (!reading || !reading.passages.length) return null;
  const keys: string[] = [];
  for (let i = 0; i < reading.passages.length; i++) {
    const passage = reading.passages[i];
    const whole = prefix + reading.passageHashes[i];
    if (has(whole)) { keys.push(whole); continue; }
    // Older readings saved a clip per sentence.
    for (let s = passage.start; s < Math.min(passage.end, reading.sentences.length); s++) {
      const sentence = prefix + reading.sentenceHashes[s];
      if (!has(sentence)) return null;
      keys.push(sentence);
    }
  }
  return keys;
}

/** For each voice with audio saved for these documents, how many it reads start to finish. */
export function audiobookVoices(recs: DocRecord[], keys: Set<string>, voiceName: (prefix: string) => string): BookVoice[] {
  const prefixes = new Set<string>();
  for (const key of keys) prefixes.add(key.slice(0, key.lastIndexOf("|") + 1));
  const has = (key: string) => keys.has(key);
  const voices: BookVoice[] = [];
  for (const prefix of prefixes) {
    const complete = recs.filter((rec) => readingKeys(rec, prefix, has)).length;
    if (complete) voices.push({ prefix, name: voiceName(prefix), complete, total: recs.length });
  }
  return voices.sort((a, b) => b.complete - a.complete || a.name.localeCompare(b.name));
}

export const chapterTitle = (rec: DocRecord) => `${rec.book ? `${rec.book.chapter}. ` : ""}${catalogue(rec).title}`;

/** The saved clips that read each document in this voice. Documents missing a passage are left out. */
export async function audiobookChapters(recs: DocRecord[], prefix: string): Promise<{ chapters: BookChapter[]; missing: DocRecord[] }> {
  const saved = new Set(await audioCache.keys());
  const chapters: BookChapter[] = [];
  const missing: DocRecord[] = [];
  for (const rec of recs) {
    const keys = readingKeys(rec, prefix, (key) => saved.has(key));
    const clips = keys ? await Promise.all(keys.map((key) => audioCache.get(key))) : [];
    if (keys && clips.every((clip) => clip?.blob)) chapters.push({ rec, title: chapterTitle(rec), clips: clips as AudioRecord[] });
    else missing.push(rec);
  }
  return { chapters, missing };
}

/** The AAC setting this browser can encode, or null when it can't make an M4B. */
export async function aacEncoding(): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined" || typeof OfflineAudioContext === "undefined") return null;
  // Speech voices render at 24 kHz; the others are for encoders that only take music rates.
  for (const [sampleRate, bitrate] of [[24000, 48000], [44100, 64000], [48000, 64000]]) {
    const config: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate, numberOfChannels: 1, bitrate };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* try the next rate */ }
  }
  return null;
}

export interface AudiobookOptions {
  tags: BookTags;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface Audiobook { file: Blob; extension: "m4b" | "mp3" | "webm" }

export async function makeAudiobook(chapters: BookChapter[], opts: AudiobookOptions): Promise<Audiobook> {
  if (!chapters.length) throw new Error("No chapter has all its audio saved in this voice");
  const config = await aacEncoding();
  if (config) return { file: await encodeM4b(chapters, config, opts), extension: "m4b" };
  return chapters.every((c) => c.clips.every((clip) => /webm/.test(clip.mime || clip.blob.type))) ? { file: await joinWebm(chapters, opts), extension: "webm" } : { file: await joinMp3(chapters, opts), extension: "mp3" };
}

// Playback's own polish, so the book sounds as it does in the app: passages start just before the
// voice does, long trailing silences are shortened, and louder passages are brought down to the rest.
const LEAD_KEEP_SECONDS = 0.05;
const TAIL_KEEP_SECONDS = 0.25;
const MIN_GAIN = 0.5;
const CHAPTER_GAP_SECONDS = 1.5;
/** Encoded audio is gathered into a Blob this often, so the frames don't pile up as separate arrays. */
const FLUSH_BYTES = 4 * 1024 * 1024;

const mono = (buffer: AudioBuffer): Float32Array => {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
};

async function encodeM4b(chapters: BookChapter[], config: AudioEncoderConfig, opts: AudiobookOptions): Promise<Blob> {
  const rate = config.sampleRate;
  const total = chapters.reduce((n, c) => n + c.clips.length, 0);
  const levels = chapters.flatMap((c) => c.clips.map((clip) => clip.loudness)).filter((l): l is number => typeof l === "number" && Number.isFinite(l));
  const reference = levels.length ? levels.reduce((a, b) => Math.min(a, b)) : null;
  // Decoding through a context at the book's rate resamples every clip to it.
  const context = new OfflineAudioContext(1, 1, rate);

  const blobs: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const sizes: number[] = [];
  let description: Uint8Array | undefined;
  let failure: unknown;
  const audioEncoder = new AudioEncoder({
    output(chunk, meta) {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      pending.push(bytes);
      pendingBytes += bytes.length;
      sizes.push(bytes.length);
      const given = meta?.decoderConfig?.description;
      if (given && !description) description = new Uint8Array(ArrayBuffer.isView(given) ? given.buffer.slice(given.byteOffset, given.byteOffset + given.byteLength) : given.slice(0));
      if (pendingBytes >= FLUSH_BYTES) { blobs.push(new Blob(pending as BlobPart[])); pending = []; pendingBytes = 0; }
    },
    error(error) { failure = error; },
  });
  audioEncoder.configure(config);

  let fed = 0;
  const feed = async (samples: Float32Array) => {
    if (!samples.length) return;
    audioEncoder.encode(new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: Math.round((fed / rate) * 1e6), data: samples as Float32Array<ArrayBuffer> }));
    fed += samples.length;
    while (audioEncoder.encodeQueueSize > 4 && !failure) await new Promise((resolve) => setTimeout(resolve, 5));
    if (failure) throw failure;
  };

  const starts: Chapter[] = [];
  let done = 0;
  try {
    for (const [index, chapter] of chapters.entries()) {
      starts.push({ title: chapter.title, start: fed });
      for (const clip of chapter.clips) {
        opts.signal?.throwIfAborted();
        let buffer: AudioBuffer;
        try {
          buffer = await context.decodeAudioData(await clip.blob.arrayBuffer());
        } catch {
          throw new Error(`A passage of “${chapter.title}” couldn't be decoded`);
        }
        const pcm = mono(buffer);
        const from = clip.lead ? Math.floor(Math.max(0, clip.lead - LEAD_KEEP_SECONDS) * rate) : 0;
        const cut = clip.tail && clip.tail > TAIL_KEEP_SECONDS ? Math.floor((clip.tail - TAIL_KEEP_SECONDS) * rate) : 0;
        const samples = pcm.slice(Math.min(from, pcm.length), Math.max(from, pcm.length - cut));
        if (reference !== null && typeof clip.loudness === "number" && Number.isFinite(clip.loudness)) {
          const gain = Math.max(MIN_GAIN, Math.min(1, 10 ** ((reference - clip.loudness) / 20)));
          if (gain < 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
        }
        await feed(samples);
        opts.onProgress?.(++done, total);
      }
      if (index < chapters.length - 1) await feed(new Float32Array(Math.round(CHAPTER_GAP_SECONDS * rate)));
    }
    await audioEncoder.flush();
  } finally {
    if (audioEncoder.state !== "closed") audioEncoder.close();
  }
  if (failure) throw failure;
  blobs.push(new Blob(pending as BlobPart[]));
  return muxM4b({ sampleRate: rate, channels: 1, config: description ? audioSpecificConfig(description) : aacConfig(rate, 1), data: new Blob(blobs), sizes, bitrate: config.bitrate ?? 64000 }, starts, opts.tags);
}

/** Opus clips joined packet by packet into one WebM. Read whole, so this suits a browser on a computer. */
async function joinWebm(chapters: BookChapter[], opts: AudiobookOptions): Promise<Blob> {
  const clips = chapters.flatMap((c) => c.clips);
  const bytes: Uint8Array[] = [];
  for (const clip of clips) {
    opts.signal?.throwIfAborted();
    bytes.push(new Uint8Array(await clip.blob.arrayBuffer()));
    opts.onProgress?.(bytes.length, clips.length);
  }
  const joined = joinWebmOpus(bytes);
  if (!joined) throw new Error("These passages can't be joined into one file in this browser. Try Safari or the iPhone app.");
  return new Blob([joined as Uint8Array<ArrayBuffer>], { type: "audio/webm" });
}

async function joinMp3(chapters: BookChapter[], opts: AudiobookOptions): Promise<Blob> {
  const total = chapters.reduce((n, c) => n + c.clips.length, 0);
  const parts: Blob[] = [];
  const marks: Mp3Chapter[] = [];
  let ms = 0;
  let done = 0;
  for (const chapter of chapters) {
    const start = ms;
    for (const clip of chapter.clips) {
      opts.signal?.throwIfAborted();
      const audio = mp3Audio(new Uint8Array(await clip.blob.arrayBuffer()));
      if (!audio) throw new Error(`A passage of “${chapter.title}” is neither MP3 nor Opus, so this browser can't join it. Try Safari or the iPhone app.`);
      parts.push(clip.blob.slice(audio.start, audio.end));
      ms += (audio.samples / audio.sampleRate) * 1000;
      opts.onProgress?.(++done, total);
    }
    marks.push({ title: chapter.title, start, end: ms });
  }
  return new Blob([id3Chapters(opts.tags, marks) as Uint8Array<ArrayBuffer>, ...parts], { type: "audio/mpeg" });
}
