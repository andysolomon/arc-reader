import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { PreparationRequest, PreparationStatus, SharedPreparation } from "./src/engine/preparation";
import { PreparationWorkers, type PreparationWorker } from "./vite.preparation-workers";

interface Job extends PreparationStatus {
  requests: PreparationRequest[];
  completed: number[];
  start: number;
  workerId?: string;
  createdAt?: number;
}
interface Audio { body: Buffer; type: string; duration?: string; words?: string }
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
class RetryableError extends Error {}
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ALIAS = /^(alloy|ash|ballad|cedar|coral|echo|fable|marin|nova|onyx|sage|shimmer|verse)$/;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const signature = (requests: PreparationRequest[]) => digest(requests.map(({ cached: _, ...item }) => item));

/** Disk-backed jobs belong to the web server, never to an HTTP connection. */
export class PreparationService {
  private jobs = new Map<string, Job>();
  private inflight = new Map<string, { promise: Promise<Audio>; consumers: Set<() => boolean> }>();
  private writes = new Map<string, Promise<void>>();
  private queues = new Map<string, Promise<unknown>>();
  private active = new Map<string, PreparationWorker>();
  private changes = new Map<string, Set<() => void>>();
  private scheduling = new Map<string, Promise<void>>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private uploaded = new Set<string>();
  private discovery: PreparationWorkers;
  private ready: Promise<void>;
  constructor(env: Record<string, string>, private directory = resolve(env.PREPARATION_DATA_DIR || ".readaloud-preparations")) {
    this.discovery = new PreparationWorkers(env);
    this.ready = this.restore();
  }

  private async restore() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await readdir(this.directory);
    for (const file of files) {
      const path = resolve(this.directory, file);
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > RETENTION_MS) { await rm(path, { force: true }); continue; }
      if (/^shared-[a-f0-9]{64}\.json$/.test(file) && files.includes(file.replace(/\.json$/, ".bin"))) this.uploaded.add(file.slice(7, -5));
      if (!file.startsWith("job-") || !file.endsWith(".json")) continue;
      try {
        const job = JSON.parse(await readFile(path, "utf8")) as Job;
        this.jobs.set(job.id, job);
        if (job.state === "running" && job.workerId && !this.discovery.workers.some((worker) => worker.id === job.workerId)) {
          job.state = "error";
          job.error = "The preparation machine is no longer configured. Prepare this reading again.";
          await this.persist(job);
        }
      } catch { /* ignore an incomplete file */ }
    }
    this.schedule();
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
    const worker = this.discovery.workers.find((worker) => worker.id === job.workerId);
    return { id: job.id, state: job.state, done: job.done, total: job.total,
      queued: job.state === "running" && !this.active.has(job.id),
      ...(worker && (job.state !== "running" || this.active.has(job.id)) ? { worker: worker.name } : {}),
      ...(job.error ? { error: job.error } : {}) };
  }

  private notify(job: Job) {
    for (const resolve of this.changes.get(job.id) || []) resolve();
    this.changes.delete(job.id);
  }

  private wait(job: Job, milliseconds?: number) {
    return new Promise<void>((resolve) => {
      const waiters = this.changes.get(job.id) || new Set();
      const finish = () => {
        clearTimeout(timer);
        waiters.delete(finish);
        if (!waiters.size) this.changes.delete(job.id);
        resolve();
      };
      const timer = milliseconds === undefined ? undefined : setTimeout(finish, milliseconds);
      waiters.add(finish);
      this.changes.set(job.id, waiters);
    });
  }

  private schedule() {
    // Discovery on a disconnected secondary must never stall the primary.
    for (const worker of this.discovery.workers) {
      const pending = (this.scheduling.get(worker.id) || Promise.resolve())
        .then(() => this.assign(worker)).finally(() => this.retryDiscovery());
      this.scheduling.set(worker.id, pending);
    }
  }

  private async assign(worker: PreparationWorker) {
    if ([...this.active.values()].some((active) => active.id === worker.id)) return;
    const pending = [...this.jobs.values()].filter((job) => job.state === "running" && !this.active.has(job.id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const job of pending) {
      // Keep partial audio on its original machine after a web restart.
      if (job.workerId && job.workerId !== worker.id) continue;
      // New readings belong to the primary whenever it is free. The secondary
      // is overflow capacity; discovery completion order must not decide priority.
      if (worker.id !== "primary" && !job.workerId && !this.primaryBusy()) return;
      if (!await this.discovery.supports(worker, job.requests)) continue;
      if (job.state !== "running" || this.active.has(job.id)) continue;
      // The primary may have finished while secondary discovery was in flight.
      if (worker.id !== "primary" && !job.workerId && !this.primaryBusy()) return;
      job.workerId = worker.id;
      this.active.set(job.id, worker);
      this.notify(job);
      void this.persist(job).then(() => this.run(job, worker)).catch(async (error) => {
        if (job.state !== "cancelled") { job.state = "error"; job.error = (error as Error).message; }
        await this.persist(job).catch(() => {});
      }).finally(() => {
        this.active.delete(job.id);
        this.notify(job);
        this.schedule();
      });
      break;
    }
  }

  private primaryBusy() {
    return [...this.active.values()].some((worker) => worker.id === "primary");
  }

  private retryDiscovery() {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    // A restored secondary job can outlive a temporary outage, even when the
    // primary has no work whose completion could wake the scheduler.
    if ([...this.jobs.values()].some((job) => job.state === "running" && !this.active.has(job.id))
      && this.discovery.workers.some((worker) => ![...this.active.values()].some((active) => active.id === worker.id))) {
      this.retryTimer = setTimeout(() => this.schedule(), 5000);
      this.retryTimer.unref();
    }
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
    const fingerprint = signature(requests);
    const existing = [...this.jobs.values()].find((job) => job.state === "running" && signature(job.requests) === fingerprint);
    if (existing) return this.status(existing);
    if ([...this.jobs.values()].filter((job) => job.state === "running").length >= 20) throw new HttpError(429, "Too many audio preparations. Try again later.");
    const job: Job = { id: randomUUID(), requests, start: start!, completed: [], done: 0, total: requests.length, state: "running", createdAt: Date.now() };
    this.jobs.set(job.id, job);
    try { await this.persist(job); }
    catch (error) { this.jobs.delete(job.id); throw error; }
    this.schedule();
    return this.status(job);
  }

  async get(id: string): Promise<PreparationStatus> { return this.status(await this.job(id)); }
  async list(): Promise<{ jobs: SharedPreparation[] }> {
    await this.ready;
    return { jobs: [...this.jobs.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((job) => ({
      ...this.status(job), keys: job.requests.map((item) => item.key),
      available: job.requests.flatMap((request, index) => (this.uploaded.has(digest(request.key)) || (!request.cached && job.completed.includes(index))) ? [index] : []),
      deviceOnly: job.requests.flatMap((request, index) => request.cached && !this.uploaded.has(digest(request.key)) ? [index] : []),
      voice: job.requests[0].voice, engine: job.requests[0].engine, profile: job.requests[0].profile,
      createdAt: job.createdAt || 0,
    })) };
  }
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
      this.notify(job);
      await this.persist(job);
      this.schedule();
    }
    return this.status(job);
  }

  private async run(job: Job, worker: PreparationWorker) {
    try {
      for (let k = 0; k < job.total; k++) {
        if (job.state !== "running") return;
        const index = (job.start + k) % job.total;
        if (job.completed.includes(index)) continue;
        for (let attempt = 0; ; attempt++) {
          try {
            if (!job.requests[index].cached) await this.audioFor(job.requests[index], () => job.state === "running", worker);
            break;
          } catch (error) {
            if (job.state !== "running") return;
            // A restarting speech server must not turn durable work into a
            // terminal error. Keep this passage pending until it comes back.
            if (!(error instanceof TypeError) && !(error instanceof RetryableError) && (error as Error)?.name !== "TimeoutError") throw error;
            await this.wait(job, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
            if (job.state !== "running") return;
          }
        }
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
    const uploaded = digest(job.requests[index].key);
    if (this.uploaded.has(uploaded)) {
      try {
        const metadata = JSON.parse(await readFile(resolve(this.directory, `shared-${uploaded}.json`), "utf8"));
        return { ...metadata, body: await readFile(resolve(this.directory, `shared-${uploaded}.bin`)) };
      } catch { this.uploaded.delete(uploaded); }
    }
    if (job.requests[index].cached) throw new HttpError(410, "This passage was already cached on the device.");
    // Playback can observe queued work, but cannot bypass the reading's machine
    // reservation by starting a second voice on an occupied worker.
    while (job.state === "running" && !this.active.has(job.id) && !job.completed.includes(index)) await this.wait(job);
    // Only read completed or in-flight work; playback never starts a cancelled job.
    if (job.state === "error" && !job.completed.includes(index)) throw new HttpError(410, "This passage was not prepared. Retry speech generation.");
    const worker = this.discovery.workers.find((worker) => worker.id === job.workerId) || this.discovery.workers[0];
    return this.audioFor(job.requests[index], () => job.state === "running" && this.active.has(job.id), worker);
  }

  /** Adopt an existing device clip; this never starts synthesis or changes job assignments. */
  async publish(id: string, index: number, audio: Audio) {
    const job = await this.job(id);
    if (!Number.isInteger(index) || index < 0 || index >= job.total) throw new HttpError(404, "Passage not found.");
    if (!audio.body.length || audio.body.length > 32 * 1024 * 1024) throw new HttpError(413, "Audio clip must be between 1 byte and 32 MB.");
    if (!audio.type.startsWith("audio/") && audio.type !== "application/octet-stream") throw new HttpError(415, "Expected an audio clip.");
    const key = digest(job.requests[index].key);
    const writeKey = `shared:${key}`;
    const write = (this.writes.get(writeKey) || Promise.resolve()).catch(() => {}).then(async () => {
      if (this.uploaded.has(key)) return;
      const { body, ...metadata } = audio;
      await this.atomic(`shared-${key}.bin`, body);
      await this.atomic(`shared-${key}.json`, JSON.stringify(metadata));
      this.uploaded.add(key);
    });
    this.writes.set(writeKey, write);
    try { await write; }
    finally { if (this.writes.get(writeKey) === write) this.writes.delete(writeKey); }
    return { shared: true };
  }

  private audioFor(item: PreparationRequest, allowed: () => boolean, worker: PreparationWorker): Promise<Audio> {
    const key = digest([worker.target, item.protocol, item.engine, item.voice, !!item.profile, item.text]);
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
        const response = await this.synthesize(item, worker);
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
      const pending = (this.queues.get(worker.id) || Promise.resolve()).then(generate, generate);
      this.queues.set(worker.id, pending.catch(() => {}));
      return pending;
    };
    const pending = run();
    this.inflight.set(key, { promise: pending, consumers });
    void pending.finally(() => this.inflight.delete(key)).catch(() => {});
    return pending;
  }

  private async upstream(worker: PreparationWorker, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${worker.target}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(worker.key ? { Authorization: `Bearer ${worker.key}` } : {}) },
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
        const message = (typeof data?.detail === "string" ? data.detail : data?.detail?.message) || data?.error?.message || `Speech generation failed (HTTP ${response.status}).`;
        if (response.status === 408 || response.status === 429 || response.status >= 500) throw new RetryableError(message);
        throw new HttpError(502, message);
      }
      return response;
    }
  }

  private async synthesize(item: PreparationRequest, worker: PreparationWorker) {
    if (item.protocol === "readaloud") return this.upstream(worker, "/tts", { text: item.text, voice: item.voice, provider: item.engine, format: "mp3" });
    if (item.profile) {
      const response = await this.upstream(worker, "/engines");
      const capabilities = await response.json() as { tts: { active: string; backends: { id: string; supports_cloning?: boolean }[] } };
      if (capabilities.tts.active !== item.engine || !capabilities.tts.backends.find((b) => b.id === item.engine)?.supports_cloning) {
        throw new HttpError(409, "The VoiceStudio cloning engine changed. Refresh Voices before preparing this saved voice.");
      }
    }
    return this.upstream(worker, "/v1/audio/speech", {
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
        if (req.method === "GET" && path === "/") return send(res, 200, await service.list());
        if (req.method === "POST" && path === "/") return send(res, 202, await service.submit(await body(req)));
        const match = /^\/([a-f0-9-]{36})(?:\/audio\/(\d+))?$/.exec(path);
        if (!match) throw new HttpError(404, "Not found.");
        if (req.method === "PUT" && match[2] !== undefined) {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 32 * 1024 * 1024) throw new HttpError(413, "Audio clip exceeds 32 MB.");
            chunks.push(Buffer.from(chunk));
          }
          const duration = req.headers["x-duration"];
          const words = req.headers["x-word-timings"];
          return send(res, 200, await service.publish(match[1], Number(match[2]), {
            body: Buffer.concat(chunks), type: req.headers["content-type"] || "application/octet-stream",
            ...(typeof duration === "string" && Number.isFinite(Number(duration)) && Number(duration) > 0 ? { duration } : {}),
            ...(typeof words === "string" ? { words } : {}),
          }));
        }
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
