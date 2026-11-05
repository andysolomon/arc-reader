import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { PreparationRequest, PreparationStatus } from "./src/engine/preparation";

interface Job extends PreparationStatus {
  requests: PreparationRequest[];
  completed: number[];
  start: number;
}
interface Audio { body: Buffer; type: string; duration?: string; words?: string }
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ALIAS = /^(alloy|ash|ballad|cedar|coral|echo|fable|marin|nova|onyx|sage|shimmer|verse)$/;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Disk-backed jobs belong to the web server, never to an HTTP connection. */
export class PreparationService {
  private jobs = new Map<string, Job>();
  private inflight = new Map<string, { promise: Promise<Audio>; consumers: Set<() => boolean> }>();
  private writes = new Map<string, Promise<void>>();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private target: string;
  constructor(private env: Record<string, string>, private directory = resolve(env.PREPARATION_DATA_DIR || ".readaloud-preparations")) {
    this.target = (env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/$/, "");
    this.ready = this.restore();
  }

  private async restore() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory)) {
      const path = resolve(this.directory, file);
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > RETENTION_MS) { await rm(path, { force: true }); continue; }
      if (!file.startsWith("job-") || !file.endsWith(".json")) continue;
      try {
        const job = JSON.parse(await readFile(path, "utf8")) as Job;
        this.jobs.set(job.id, job);
        if (job.state === "running") void this.run(job);
      } catch { /* ignore an incomplete file */ }
    }
  }

  private async atomic(file: string, data: string | Buffer) {
    const path = resolve(this.directory, file);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, path);
  }
  private persist(job: Job) {
    const data = JSON.stringify(job);
    const write = (this.writes.get(job.id) || Promise.resolve()).catch(() => {}).then(() => this.atomic(`job-${job.id}.json`, data));
    this.writes.set(job.id, write);
    void write.finally(() => { if (this.writes.get(job.id) === write) this.writes.delete(job.id); }).catch(() => {});
    return write;
  }
  private status(job: Job): PreparationStatus {
    return { id: job.id, state: job.state, done: job.done, total: job.total, ...(job.error ? { error: job.error } : {}) };
  }

  async submit(raw: unknown): Promise<PreparationStatus> {
    await this.ready;
    const { requests, start } = (raw || {}) as { requests?: PreparationRequest[]; start?: number };
    if (!Array.isArray(requests) || !requests.length || requests.length > 5000 || !Number.isInteger(start) || start! < 0 || start! >= requests.length) {
      throw new HttpError(400, "Invalid audio preparation request.");
    }
    for (const item of requests) {
      if (!item || typeof item.text !== "string" || !item.text.trim() || item.text.length > 20000
        || typeof item.voice !== "string" || !item.voice || item.voice.length > 200
        || typeof item.engine !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.engine)
        || ["openai", "fish", "local"].includes(item.engine)
        || typeof item.key !== "string" || item.key.length > 500
        || (item.profile !== undefined && typeof item.profile !== "boolean")
        || (item.cached !== undefined && typeof item.cached !== "boolean")
        || !["openai", "readaloud"].includes(item.protocol)) {
        throw new HttpError(400, "Preparation supports VoiceStudio voices only.");
      }
    }
    const existing = [...this.jobs.values()].find((job) => job.state === "running" && JSON.stringify(job.requests) === JSON.stringify(requests));
    if (existing) return this.status(existing);
    if ([...this.jobs.values()].filter((job) => job.state === "running").length >= 20) throw new HttpError(429, "Too many audio preparations. Try again later.");
    const job: Job = { id: randomUUID(), requests, start: start!, completed: [], done: 0, total: requests.length, state: "running" };
    await this.persist(job);
    this.jobs.set(job.id, job);
    void this.run(job);
    return this.status(job);
  }

  async get(id: string): Promise<PreparationStatus> { return this.status(await this.job(id)); }
  private async job(id: string) {
    await this.ready;
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "Audio preparation expired. Please prepare it again.");
    return job;
  }
  async cancel(id: string) {
    const job = await this.job(id);
    if (job.state === "running") {
      job.state = "cancelled";
      await this.persist(job);
    }
    return this.status(job);
  }

  private async run(job: Job) {
    try {
      for (let k = 0; k < job.total; k++) {
        if (job.state !== "running") return;
        const index = (job.start + k) % job.total;
        if (job.completed.includes(index)) continue;
        if (!job.requests[index].cached) await this.audioFor(job.requests[index], () => job.state === "running");
        job.completed.push(index);
        job.done = job.completed.length;
        await this.persist(job);
      }
      if (job.state === "running") job.state = "done";
      await this.persist(job);
    } catch (error) {
      if (job.state === "cancelled") return;
      job.state = "error";
      job.error = (error as Error).message;
      await this.persist(job).catch(() => {});
    }
  }

  async audio(id: string, index: number): Promise<Audio> {
    const job = await this.job(id);
    if (!Number.isInteger(index) || index < 0 || index >= job.total) throw new HttpError(404, "Passage not found.");
    if (job.requests[index].cached) throw new HttpError(410, "This passage was already cached on the device.");
    // Only read completed or in-flight work; playback never starts a cancelled job.
    if (job.state === "error" && !job.completed.includes(index)) throw new HttpError(410, "This passage was not prepared. Retry speech generation.");
    return this.audioFor(job.requests[index], () => job.state === "running");
  }

  private audioFor(item: PreparationRequest, allowed: () => boolean): Promise<Audio> {
    const key = digest([this.target, item.protocol, item.engine, item.voice, !!item.profile, item.text]);
    const existing = this.inflight.get(key);
    if (existing) {
      existing.consumers.add(allowed);
      return existing.promise;
    }
    const consumers = new Set([allowed]);
    const run = async () => {
      try {
        const metadata = JSON.parse(await readFile(resolve(this.directory, `${key}.json`), "utf8")) as Omit<Audio, "body">;
        return { ...metadata, body: await readFile(resolve(this.directory, `${key}.bin`)) };
      } catch { /* not cached */ }
      // Cache hits must never wait behind slow inference for another voice.
      // Only misses enter the single-worker queue, one passage per job at a time.
      const generate = async () => {
        if (![...consumers].some((isAllowed) => isAllowed())) throw new HttpError(410, "Audio preparation was cancelled or expired.");
        const response = await this.synthesize(item);
        const body = Buffer.from(await response.arrayBuffer());
        const type = response.headers.get("content-type") || "audio/mpeg";
        if (!body.length || (!type.startsWith("audio/") && type !== "application/octet-stream" && !(item.protocol === "readaloud" && type.includes("json")))) {
          throw new HttpError(502, "The speech server returned no playable audio.");
        }
        const metadata = { type, duration: response.headers.get("x-duration") || undefined, words: response.headers.get("x-word-timings") || undefined };
        await this.atomic(`${key}.bin`, body);
        await this.atomic(`${key}.json`, JSON.stringify(metadata));
        return { body, ...metadata };
      };
      const pending = this.queue.then(generate, generate);
      this.queue = pending.catch(() => {});
      return pending;
    };
    const pending = run();
    this.inflight.set(key, { promise: pending, consumers });
    void pending.finally(() => this.inflight.delete(key)).catch(() => {});
    return pending;
  }

  private async upstream(path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${this.target}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(this.env.VOICESTUDIO_API_KEY ? { Authorization: `Bearer ${this.env.VOICESTUDIO_API_KEY}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(1_800_000),
      });
      if (response.status === 429 && attempt < 4) {
        const delay = Math.min(30000, Number(response.headers.get("retry-after")) * 1000 || 400 * 2 ** attempt);
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { detail?: string | { message?: string }; error?: { message?: string } } | null;
        throw new HttpError(502, (typeof data?.detail === "string" ? data.detail : data?.detail?.message) || data?.error?.message || `Speech generation failed (HTTP ${response.status}).`);
      }
      return response;
    }
  }

  private async synthesize(item: PreparationRequest) {
    if (item.protocol === "readaloud") return this.upstream("/tts", { text: item.text, voice: item.voice, provider: item.engine, format: "mp3" });
    if (item.profile) {
      const response = await this.upstream("/engines");
      const capabilities = await response.json() as { tts: { active: string; backends: { id: string; supports_cloning?: boolean }[] } };
      if (capabilities.tts.active !== item.engine || !capabilities.tts.backends.find((b) => b.id === item.engine)?.supports_cloning) {
        throw new HttpError(409, "The VoiceStudio cloning engine changed. Refresh Voices before preparing this saved voice.");
      }
    }
    return this.upstream("/v1/audio/speech", {
      model: item.profile || ALIAS.test(item.voice) ? "tts-1" : item.engine,
      input: item.text, voice: item.voice, response_format: "mp3", speed: 1,
      ...(["omnivoice", "omnivoice-subprocess"].includes(item.engine) ? { num_step: 16 } : {}),
    });
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 5 * 1024 * 1024) throw new HttpError(413, "This document is too large to prepare.");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Invalid JSON."); }
}

export function audioPreparation(env: Record<string, string>): Plugin {
  let service: PreparationService;
  const middleware: Connect.NextHandleFunction = (req, res) => {
    void (async () => {
      try {
        if (req.headers["sec-fetch-site"] === "cross-site" || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
          throw new HttpError(403, "Use the app to prepare audio.");
        }
        const path = new URL(req.url || "/", "http://localhost").pathname;
        if (req.method === "POST" && path === "/") return send(res, 202, await service.submit(await body(req)));
        const match = /^\/([a-f0-9-]{36})(?:\/audio\/(\d+))?$/.exec(path);
        if (!match) throw new HttpError(404, "Not found.");
        if (req.method === "GET" && match[2] !== undefined) {
          const audio = await service.audio(match[1], Number(match[2]));
          res.writeHead(200, { "content-type": audio.type, "cache-control": "no-store", ...(audio.duration ? { "x-duration": audio.duration } : {}), ...(audio.words ? { "x-word-timings": audio.words } : {}) });
          return res.end(audio.body);
        }
        if (req.method === "GET") return send(res, 200, await service.get(match[1]));
        if (req.method === "DELETE" && !match[2]) return send(res, 200, await service.cancel(match[1]));
        throw new HttpError(405, "Method not allowed.");
      } catch (error) {
        if (!res.headersSent) send(res, error instanceof HttpError ? error.status : 500, { error: (error as Error).message });
      }
    })();
  };
  const mount = (server: { middlewares: Connect.Server }) => {
    service ??= new PreparationService(env);
    server.middlewares.use("/api/preparations", middleware);
  };
  return { name: "readaloud:audio-preparation", configureServer: mount, configurePreviewServer: mount };
}
