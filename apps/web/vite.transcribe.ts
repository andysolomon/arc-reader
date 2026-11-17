import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { HttpError } from "./vite.llm";
import { sendJson } from "./vite.json";
import type { SpeechActivity } from "./vite.speech-activity";
import { FXTWITTER_API, xPostId, xPostVideo, type FxTweet, type XVideo } from "./vite.xpost";
import type { TranscriptStatus } from "./src/lib/videoTranscript";

/**
 * /api/transcribe?url=<X post> turns what is said in the post's video into text.
 * GET reports where that stands; POST starts it. The work outlasts the request, so a phone that
 * sleeps or loses its connection picks the result up later:
 *
 *   1. The smallest MP4 of the video is downloaded and piped through ffmpeg, which keeps only
 *      the sound, as 16 kHz mono samples in a temporary file.
 *   2. The sound goes to VoiceStudio's /transcribe five minutes at a time. One request for a
 *      whole video would outlast VoiceStudio's five-minute limit on a transcription, and pieces
 *      let someone listening get a turn in between.
 *   3. A piece rarely ends where a sentence does. Its last sentence is dropped and the next
 *      piece starts where that sentence did, so no word is cut in two.
 *   4. The sentences are gathered into paragraphs and kept in LIBRARY_DATA_DIR/transcripts,
 *      so the same post is never transcribed twice.
 *
 * One video is transcribed at a time. Without ffmpeg on this machine no video is offered.
 */

const SAMPLE_RATE = 16_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
export const PIECE_SECONDS = 300;
/** Sound shorter than this at the very end holds no words worth a request. */
const TAIL_SECONDS = 0.5;
export const MAX_VIDEO_SECONDS = 4 * 60 * 60;
/** The smallest MP4 of a four-hour video is well under this. */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const LOOKUP_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
/** VoiceStudio gives up on a transcription after five minutes. */
const PIECE_TIMEOUT_MS = 330_000;
const LOOKUP_TTL_MS = 10 * 60_000;
/** VoiceStudio answers 429 while its one worker and one queue slot are taken: about ten minutes of asking again. */
const BUSY_ATTEMPTS = 20;
const ERROR_ATTEMPTS = 2;

export interface Segment { start: number; end: number; text: string }
interface Saved { text: string; seconds: number; at: number }
interface Job { state: "waiting" | "fetching" | "transcribing" | "failed"; seconds: number; done: number; error?: string }

export interface TranscriptDeps {
  fetch?: typeof fetch;
  /** Writes the video's sound to `file` as 16 kHz mono 16-bit samples. */
  sound?: (video: ReadableStream<Uint8Array>, file: string) => Promise<void>;
  /** Whether `sound` can work on this machine. */
  available?: () => Promise<boolean>;
  wait?: (ms: number) => Promise<void>;
}

/** A WAV file of 16 kHz mono 16-bit samples. */
export function wav(samples: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

const PARAGRAPH_CHARS = 400;
const LONG_PARAGRAPH_CHARS = 900;
const PAUSE_SECONDS = 0.5;

/**
 * Sentences gathered into paragraphs. A speaker's pause after a few sentences starts a new one,
 * and so does a paragraph that has run long, since a talk read off a page has no breaks of its own.
 */
export function transcriptParagraphs(segments: Segment[]): string[] {
  const paragraphs: string[] = [];
  let current = "";
  let previousEnd = 0;
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const ended = /[.!?…]["'”’)]?$/.test(current);
    const paused = segment.start - previousEnd >= PAUSE_SECONDS;
    if (current && ended && ((paused && current.length >= PARAGRAPH_CHARS) || current.length >= LONG_PARAGRAPH_CHARS)) {
      paragraphs.push(current);
      current = "";
    }
    current = current ? `${current} ${text}` : text;
    previousEnd = segment.end;
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

/** ffmpeg reads the video from its input and never opens a network address itself. */
export function ffmpegSound(binary: string) {
  return (video: ReadableStream<Uint8Array>, file: string) => new Promise<void>((done, fail) => {
    const child = spawn(binary, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "pipe,file", "-i", "pipe:0",
      "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-y", file,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let complaint = "";
    child.stderr.on("data", (chunk: Buffer) => { complaint = (complaint + chunk.toString("utf8")).slice(-2000); });
    const source = Readable.fromWeb(video as Parameters<typeof Readable.fromWeb>[0]);
    let downloadError: Error | undefined;
    source.on("error", (error) => { downloadError = error; child.kill(); });
    // ffmpeg stops reading when it has failed; its exit says why.
    child.stdin.on("error", () => source.destroy());
    source.pipe(child.stdin);
    child.on("error", (error) => { source.destroy(); fail(error); });
    child.on("close", (code) => {
      source.destroy();
      if (downloadError) return fail(downloadError);
      if (code === 0) return done();
      if (/does not contain any stream|matches no streams/i.test(complaint)) return fail(new HttpError(422, "That video has no sound to transcribe."));
      console.error("ffmpeg could not read a video:", complaint.trim());
      fail(new HttpError(502, "The video couldn't be read."));
    });
  });
}

function ffmpegAvailable(binary: string): () => Promise<boolean> {
  let found: Promise<boolean> | undefined;
  return () => found ??= new Promise<boolean>((answer) => {
    const child = spawn(binary, ["-version"], { stdio: "ignore" });
    child.on("error", () => answer(false));
    child.on("close", (code) => answer(code === 0));
  });
}

const view = (job: Job): TranscriptStatus => ({
  state: job.state, seconds: job.seconds, done: Math.min(job.seconds, Math.floor(job.done)), ...(job.error ? { error: job.error } : {}),
});

export class VideoTranscripts {
  private jobs = new Map<string, Job>();
  private lookups = new Map<string, { expires: number; value: Promise<XVideo | null> }>();
  private queue: Promise<void> = Promise.resolve();
  private fetch: typeof fetch;
  private sound: NonNullable<TranscriptDeps["sound"]>;
  private available: NonNullable<TranscriptDeps["available"]>;
  private wait: NonNullable<TranscriptDeps["wait"]>;

  constructor(
    private directory: string,
    private studio: { target: string; key: string },
    private activity?: SpeechActivity,
    deps: TranscriptDeps = {},
    ffmpeg = "ffmpeg",
  ) {
    this.fetch = deps.fetch ?? fetch;
    this.sound = deps.sound ?? ffmpegSound(ffmpeg);
    this.available = deps.available ?? ffmpegAvailable(ffmpeg);
    this.wait = deps.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  }

  /** Where the post's video stands, without starting anything. */
  async status(id: string): Promise<TranscriptStatus> {
    const saved = await this.saved(id);
    if (saved) return { state: "done", seconds: saved.seconds, text: saved.text };
    const job = this.jobs.get(id);
    if (job) return view(job);
    if (!(await this.available())) return { state: "none" };
    const video = await this.video(id);
    return video ? { state: "none", seconds: video.seconds } : { state: "none" };
  }

  /** Start on the post's video, or report the transcription already under way or finished. */
  async start(id: string): Promise<TranscriptStatus> {
    const saved = await this.saved(id);
    if (saved) return { state: "done", seconds: saved.seconds, text: saved.text };
    const active = () => { const job = this.jobs.get(id); return job && job.state !== "failed" ? job : undefined; };
    if (active()) return view(active()!);
    if (!(await this.available())) throw new HttpError(503, "This server can't read video: ffmpeg is not installed.");
    const video = await this.video(id);
    if (!video) throw new HttpError(404, "That post has no video with sound.");
    if (video.seconds > MAX_VIDEO_SECONDS) throw new HttpError(413, "Videos longer than four hours can't be transcribed.");
    // Another request for the same post may have started it while this one was looking the post up.
    if (active()) return view(active()!);
    const job: Job = { state: "waiting", seconds: video.seconds, done: 0 };
    this.jobs.set(id, job);
    this.queue = this.queue.then(() => this.run(id, video, job));
    return view(job);
  }

  /** Resolves when every transcription asked for so far has finished or failed. */
  settled(): Promise<void> { return this.queue; }

  private async run(id: string, video: XVideo, job: Job) {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "readaloud-video-"));
      const file = join(directory, "sound.pcm");
      job.state = "fetching";
      await this.download(video, file);
      job.state = "transcribing";
      const text = transcriptParagraphs(await this.transcribe(file, job)).join("\n\n");
      if (!text) throw new HttpError(422, "No speech was found in that video.");
      await this.save(id, { text, seconds: job.seconds, at: Date.now() });
      this.jobs.delete(id);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(`Transcribing the video on post ${id} failed:`, error);
      job.state = "failed";
      job.error = error instanceof HttpError ? error.message : "Transcribing the video failed. Please retry.";
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async download(video: XVideo, file: string) {
    const response = await this.fetch(video.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), headers: { "user-agent": "ReadAloud" } })
      .catch(() => { throw new HttpError(502, "The video couldn't be downloaded from X. Please retry."); });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new HttpError(502, `The video couldn't be downloaded from X (HTTP ${response.status}).`);
    }
    if (Number(response.headers.get("content-length")) > MAX_VIDEO_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new HttpError(413, "That video is too large to transcribe.");
    }
    try {
      await this.sound(response.body, file);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Reading a video's sound failed:", error);
      throw new HttpError(502, "The video couldn't be downloaded from X. Please retry.");
    }
  }

  private async transcribe(file: string, job: Job): Promise<Segment[]> {
    const handle = await open(file, "r");
    try {
      const samples = Math.floor((await handle.stat()).size / 2);
      const total = samples / SAMPLE_RATE;
      const heard: Segment[] = [];
      let start = 0;
      while (total - start > TAIL_SECONDS) {
        const length = Math.min(PIECE_SECONDS, total - start);
        const last = start + length >= total;
        const piece = Buffer.alloc(Math.round(length * SAMPLE_RATE) * 2);
        await handle.read(piece, 0, piece.length, Math.round(start * SAMPLE_RATE) * 2);
        let segments = await this.recognize(wav(piece), length);
        let next = start + length;
        const cut = segments.at(-1);
        // The piece's last sentence may have been cut short: hear it whole at the start of the next piece.
        if (!last && cut && segments.length > 1 && cut.start >= length / 2) {
          segments = segments.slice(0, -1);
          next = start + cut.start;
        }
        for (const segment of segments) heard.push({ start: start + segment.start, end: start + segment.end, text: segment.text });
        start = next;
        job.done = start;
      }
      return heard;
    } finally {
      await handle.close();
    }
  }

  /** One piece's sentences with their times within the piece. */
  private async recognize(audio: Buffer, length: number): Promise<Segment[]> {
    const { target, key } = this.studio;
    for (let busy = 0, errors = 0; ;) {
      // Someone listening goes first; background preparation stands aside while a piece is heard.
      await this.activity?.free(target);
      const end = this.activity?.begin(target);
      let response: Response | undefined;
      try {
        const form = new FormData();
        form.set("audio", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "sound.wav");
        // "fast" is VoiceStudio's quickest recognizer without word timings, which nothing here uses.
        form.set("mode", "fast");
        response = await this.fetch(`${target}/transcribe`, {
          method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: form, signal: AbortSignal.timeout(PIECE_TIMEOUT_MS),
        });
      } catch {
        response = undefined;
      } finally {
        end?.();
      }
      if (response?.status === 429 && busy++ < BUSY_ATTEMPTS) {
        const delay = Math.min(30_000, Number(response.headers.get("retry-after")) * 1000 || 5000);
        await response.body?.cancel().catch(() => {});
        await this.wait(delay);
        continue;
      }
      if ((!response || response.status >= 500) && errors++ < ERROR_ATTEMPTS) {
        await response?.body?.cancel().catch(() => {});
        await this.wait(2000 * errors);
        continue;
      }
      if (!response) throw new HttpError(502, "The speech server couldn't be reached. Please retry.");
      const data = await response.json().catch(() => null) as {
        text?: unknown; segments?: unknown; detail?: string | { message?: string }; error?: { message?: string };
      } | null;
      if (!response.ok || !data) {
        const said = (typeof data?.detail === "string" ? data.detail : data?.detail?.message) || data?.error?.message;
        throw new HttpError(502, response.status === 429 ? "The speech server is busy. Please retry in a few minutes."
          : said ? `The speech server couldn't transcribe the video: ${said}` : `The speech server couldn't transcribe the video (HTTP ${response.status}).`);
      }
      const segments: Segment[] = [];
      for (const raw of Array.isArray(data.segments) ? data.segments as Record<string, unknown>[] : []) {
        if (typeof raw?.text !== "string" || !raw.text.trim()) continue;
        // A recognizer that could not time a sentence still heard it: it follows the one before.
        const start = typeof raw.start === "number" ? raw.start : segments.at(-1)?.end ?? 0;
        segments.push({ start, end: typeof raw.end === "number" ? raw.end : start, text: raw.text });
      }
      if (segments.length) return segments;
      return typeof data.text === "string" && data.text.trim() ? [{ start: 0, end: length, text: data.text }] : [];
    }
  }

  /** The post's video, asked of FxTwitter at most once every few minutes. */
  private video(id: string): Promise<XVideo | null> {
    const now = Date.now();
    const known = this.lookups.get(id);
    if (known && known.expires > now) return known.value;
    if (this.lookups.size > 500) for (const [key, lookup] of this.lookups) if (lookup.expires <= now) this.lookups.delete(key);
    const value = (async () => {
      const response = await this.fetch(`${FXTWITTER_API}/status/${id}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), headers: { "user-agent": "ReadAloud" } })
        .catch(() => { throw new HttpError(502, "The post couldn't be looked up. Please retry."); });
      if (response.status === 404) return null;
      if (!response.ok) throw new HttpError(502, `The post couldn't be looked up (HTTP ${response.status}).`);
      const { tweet } = await response.json().catch(() => ({})) as { tweet?: FxTweet };
      return tweet ? xPostVideo(tweet) : null;
    })();
    this.lookups.set(id, { expires: now + LOOKUP_TTL_MS, value });
    // A failed lookup is asked again next time.
    value.catch(() => { if (this.lookups.get(id)?.value === value) this.lookups.delete(id); });
    return value;
  }

  private path(id: string) { return join(this.directory, `${id}.json`); }

  private async saved(id: string): Promise<Saved | null> {
    try {
      const saved = JSON.parse(await readFile(this.path(id), "utf8")) as Partial<Saved>;
      return typeof saved.text === "string" && saved.text ? { text: saved.text, seconds: Number(saved.seconds) || 0, at: Number(saved.at) || 0 } : null;
    } catch { return null; }
  }

  private async save(id: string, saved: Saved) {
    await mkdir(this.directory, { recursive: true });
    const partial = `${this.path(id)}.${process.pid}.tmp`;
    await writeFile(partial, JSON.stringify(saved));
    await rename(partial, this.path(id));
  }
}

export function transcribeMiddleware(transcripts: VideoTranscripts): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "Use GET or POST.");
      if (req.method === "POST" && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        throw new HttpError(403, "Cross-origin requests are not allowed.");
      }
      let id: string | null = null;
      try { id = xPostId(new URL(new URL(req.url ?? "", "http://localhost").searchParams.get("url") ?? "")); } catch { /* Answered below. */ }
      if (!id) throw new HttpError(400, "Give the address of a post on X.");
      sendJson(req, res, 200, req.method === "POST" ? await transcripts.start(id) : await transcripts.status(id));
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("Transcript request failed:", error);
      if (!res.headersSent) sendJson(req, res, error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : "Transcribing the video failed. Please retry." } });
    });
  };
}

export function videoTranscripts(env: Record<string, string>, activity?: SpeechActivity): Plugin {
  // Beside the shared library, so transcripts live in the same volume.
  const transcripts = new VideoTranscripts(
    resolve(env.LIBRARY_DATA_DIR || ".readaloud-library", "transcripts"),
    { target: (env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/$/, ""), key: env.VOICESTUDIO_API_KEY || "" },
    activity, {}, env.FFMPEG_PATH || "ffmpeg",
  );
  const middleware = transcribeMiddleware(transcripts);
  return {
    name: "readaloud:video-transcripts",
    configureServer(server) { server.middlewares.use("/api/transcribe", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/transcribe", middleware); },
  };
}
