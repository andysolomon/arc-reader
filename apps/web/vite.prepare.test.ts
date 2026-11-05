import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreparationService } from "./vite.prepare";
import type { PreparationRequest } from "./src/engine/preparation";

const item = (text: string): PreparationRequest => ({ key: text, text, voice: "v", engine: "kittentts", protocol: "openai" });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("server-owned audio preparation", () => {
  let directory: string, upstream: Server, env: Record<string, string>;
  let calls: { path: string; body: Record<string, unknown>; authorization?: string; origin?: string }[];
  let gate: ReturnType<typeof deferred> | undefined;
  let rejectSpeech: boolean;
  let unavailable: boolean;
  beforeEach(async () => {
    calls = []; gate = undefined; rejectSpeech = false; unavailable = false;
    directory = await mkdtemp(join(tmpdir(), "readaloud-preparation-"));
    upstream = createServer(async (req, res) => {
      const buffers: Buffer[] = [];
      for await (const chunk of req) buffers.push(Buffer.from(chunk));
      calls.push({ path: req.url!, body: JSON.parse(Buffer.concat(buffers).toString() || "{}"), authorization: req.headers.authorization, origin: req.headers.origin });
      await gate?.promise;
      if (req.url === "/engines") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ tts: { active: "kittentts", backends: [{ id: "kittentts", supports_cloning: false }] } }));
      }
      if (unavailable) {
        res.writeHead(503);
        return res.end();
      }
      if (rejectSpeech) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ detail: "Model terms need acceptance" }));
      }
      res.writeHead(200, { "content-type": "audio/mpeg", "x-duration": "2" });
      res.end(`audio:${calls.at(-1)!.body.input || calls.at(-1)!.body.text}`);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    env = { VOICESTUDIO_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, VOICESTUDIO_API_KEY: "server-secret" };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    gate?.resolve();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("renders the whole document without a client polling, retains audio, and restores it after restart", async () => {
    const service = new PreparationService(env, directory);
    gate = deferred();
    const job = await service.submit({ requests: [item("first"), item("second"), item("third")], start: 1 });
    expect(job.state).toBe("running");
    await expect.poll(() => calls.length).toBe(1);
    gate.resolve();
    // No progress request or audio fetch drives the next passage.
    await expect.poll(() => calls.length).toBe(3);
    await expect.poll(async () => (await service.get(job.id)).state).toBe("done");
    expect(calls.map((call) => call.body.input)).toEqual(["second", "third", "first"]);
    expect(calls.every((call) => call.authorization === "Bearer server-secret" && !call.origin)).toBe(true);
    const restarted = new PreparationService(env, directory);
    expect(await restarted.get(job.id)).toMatchObject({ state: "done", done: 3, total: 3 });
    const audio = await restarted.audio(job.id, 0);
    expect(audio.body.toString()).toBe("audio:first");
    expect(audio.duration).toBe("2");
    expect(calls).toHaveLength(3);
  });

  it("shares in-flight work with playback and cancels the remaining passages explicitly", async () => {
    const service = new PreparationService(env, directory);
    gate = deferred();
    const job = await service.submit({ requests: [item("first"), item("second")], start: 0 });
    await expect.poll(() => calls.length).toBe(1);
    const playback = service.audio(job.id, 0);
    const duplicate = await service.submit({ requests: [{ ...item("first"), cached: true }, item("second")], start: 1 });
    expect(duplicate.id).toBe(job.id);
    await service.cancel(job.id);
    gate.resolve();
    expect((await playback).body.toString()).toBe("audio:first");
    await expect.poll(async () => (await service.get(job.id)).done).toBe(1);
    expect(await service.get(job.id)).toMatchObject({ state: "cancelled", done: 1 });
    await expect(service.audio(job.id, 1)).rejects.toThrow("cancelled");
    expect(calls).toHaveLength(1);
  });

  it("resumes a persisted running job from its remaining passages", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    await writeFile(join(directory, `job-${id}.json`), JSON.stringify({ id, requests: [item("first"), item("second")], completed: [0], start: 0, done: 1, total: 2, state: "running" }));
    const service = new PreparationService(env, directory);
    await expect.poll(async () => (await service.get(id)).state).toBe("done");
    expect(calls.map((call) => call.body.input)).toEqual(["second"]);
  });

  it("keeps a restored job running until the speech server is available again", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    await writeFile(join(directory, `job-${id}.json`), JSON.stringify({ id, requests: [item("first"), item("second")], completed: [0], start: 0, done: 1, total: 2, state: "running" }));
    unavailable = true;
    const service = new PreparationService(env, directory);
    await expect.poll(() => calls.length).toBe(1);
    expect(await service.get(id)).toMatchObject({ state: "running", done: 1 });
    unavailable = false;
    await expect.poll(async () => (await service.get(id)).state, { timeout: 5000 }).toBe("done");
    expect(calls.map((call) => call.body.input)).toEqual(["second", "second"]);
  });

  it("retries a dropped upstream connection without losing the job", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    const service = new PreparationService(env, directory);
    const job = await service.submit({ requests: [item("first")], start: 0 });
    await expect.poll(() => vi.mocked(fetch).mock.calls.length).toBe(1);
    expect(await service.get(job.id)).toMatchObject({ state: "running", done: 0 });
    await expect.poll(async () => (await service.get(job.id)).state, { timeout: 5000 }).toBe("done");
    expect(calls.map((call) => call.body.input)).toEqual(["first"]);
  });

  it("reports upstream failures without claiming the document was prepared", async () => {
    rejectSpeech = true;
    const service = new PreparationService(env, directory);
    const job = await service.submit({ requests: [item("first"), item("second")], start: 0 });
    await expect.poll(async () => (await service.get(job.id)).state).toBe("error");
    expect(await service.get(job.id)).toMatchObject({ done: 0, error: "Model terms need acceptance" });
    expect(calls).toHaveLength(1);
  });

  it("does not generate browser-cached passages or accept paid engines", async () => {
    const service = new PreparationService(env, directory);
    const job = await service.submit({ requests: [{ ...item("first"), cached: true }, item("second")], start: 0 });
    await expect.poll(async () => (await service.get(job.id)).state).toBe("done");
    expect(calls.map((call) => call.body.input)).toEqual(["second"]);
    await expect(service.audio(job.id, 0)).rejects.toThrow("already cached");
    await expect(service.submit({ requests: [{ ...item("paid"), engine: "openai" }], start: 0 })).rejects.toThrow("VoiceStudio");
    await expect(service.submit({ requests: [item("bad")], start: -1 })).rejects.toThrow("Invalid");
  });

  it("checks cloning capabilities before rendering a saved profile", async () => {
    const service = new PreparationService(env, directory);
    const job = await service.submit({ requests: [{ ...item("first"), profile: true, engine: "omnivoice" }], start: 0 });
    await expect.poll(async () => (await service.get(job.id)).state).toBe("error");
    expect(await service.get(job.id)).toMatchObject({ done: 0, error: expect.stringContaining("cloning engine changed") });
    expect(calls.map((call) => call.path)).toEqual(["/engines"]);
  });
});
