// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JAMAICAN_PATOIS_VOICE_ID, FISH_PRESET_VOICES, PRESET_VOICES } from "../data/voices";
import { cacheKey, prepareInBackground, synthesize } from "../engine/providers";
import { audioCache, db, docs, type DocRecord } from "../lib/db";
import { preparePatois } from "../lib/patois";
import { isPreparing, usePreparation, type PreparationJob } from "./preparation";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const local = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: local, configurable: true });
  vi.stubGlobal("localStorage", local);
});

vi.mock("../engine/providers", async (original) => ({ ...await original<typeof import("../engine/providers")>(), synthesize: vi.fn(), prepareInBackground: vi.fn() }));
vi.mock("../lib/patois", async (original) => ({ ...await original<typeof import("../lib/patois")>(), preparePatois: vi.fn() }));
const [bella, jasper] = PRESET_VOICES;
const record = (id: string): DocRecord => ({ id, title: id, text: `First ${id}.\n\nSecond ${id}.`, voice: null, chars: 20, source: "paste", domain: "Text", createdAt: 0, updatedAt: 0 });
const settled = async () => vi.waitFor(() => expect(usePreparation.getState().jobs.some(isPreparing)).toBe(false), { timeout: 5000 });

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  usePreparation.setState({ jobs: [] });
  const database = await db();
  await Promise.all([database.clear("docs"), database.clear("audio")]);
  await Promise.all([docs.put(record("a")), docs.put(record("b"))]);
  vi.mocked(synthesize).mockImplementation(async (req) => {
    const audio = new Blob(["audio"]);
    await audioCache.put({ key: cacheKey(req), blob: audio, mime: "audio/mpeg", duration: 1, createdAt: 0 });
    return { source: "api", audio, duration: 1 };
  });
});
afterEach(async () => { usePreparation.getState().cancelAll(); await settled(); });

describe("Library preparation queue", () => {
  it("restores interrupted and queued readings automatically, keeping finished jobs and saved progress", async () => {
    const job = (docId: string, status: PreparationJob["status"]): PreparationJob => ({
      id: docId, docId, title: docId, voice: bella, openaiModel: "tts-1", wordTimings: true,
      status, done: 1, total: 2, message: "Old preparation message",
    });
    localStorage.setItem("readaloud:preparation-queue", JSON.stringify({ state: { jobs: [
      job("a", "preparing"), job("b", "queued"), job("ready", "ready"), job("cancelled", "cancelled"), job("error", "error"),
    ] }, version: 0 }));
    await usePreparation.persist.rehydrate();
    await settled();
    expect(usePreparation.getState().jobs.map((j) => [j.docId, j.status, j.done])).toEqual([
      ["a", "ready", 2], ["b", "ready", 2], ["ready", "ready", 1], ["cancelled", "cancelled", 1], ["error", "error", 1],
    ]);
    expect(prepareInBackground).toHaveBeenCalledTimes(2);
    expect(synthesize).toHaveBeenCalledTimes(4);
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ openaiModel: "tts-1", wordTimings: true }));
    const persisted = JSON.parse(localStorage.getItem("readaloud:preparation-queue")!).state.jobs;
    expect(persisted[0]).toMatchObject({ status: "ready", done: 2 });
    expect(persisted[0].message).toBeUndefined();
  });

  it("prepares every document/voice pair, deduplicates pending jobs, and preserves document voices", async () => {
    expect(usePreparation.getState().enqueue([record("a"), record("b")], [bella, jasper])).toBe(4);
    expect(usePreparation.getState().enqueue([record("a")], [bella])).toBe(0);
    await settled();
    expect(usePreparation.getState().jobs.map((job) => [job.docId, job.voice.id, job.status, job.done, job.total])).toEqual([
      ["a", bella.id, "ready", 2, 2], ["a", jasper.id, "ready", 2, 2], ["b", bella.id, "ready", 2, 2], ["b", jasper.id, "ready", 2, 2],
    ]);
    expect(await audioCache.keys()).toHaveLength(8);
    expect(prepareInBackground).toHaveBeenCalledTimes(4);
    expect((await docs.get("a"))?.voice).toBeNull();
  });

  it("resumes downloading after a restart and reuses passages already saved on the device", async () => {
    const generate = vi.mocked(synthesize).getMockImplementation()!;
    let disconnected = false;
    const generated: string[] = [];
    vi.mocked(synthesize).mockImplementation(async (req) => {
      if (req.text === "Second a." && !disconnected) {
        disconnected = true;
        throw new TypeError("Server restarted");
      }
      const cached = await audioCache.get(cacheKey(req));
      if (cached) return { source: "cache", audio: cached.blob, duration: cached.duration };
      generated.push(req.text);
      return generate(req);
    });
    usePreparation.getState().enqueue([record("a")], [bella]);
    await vi.waitFor(() => expect(usePreparation.getState().jobs[0]).toMatchObject({ status: "preparing", done: 1, message: expect.stringContaining("reconnect") }));
    await settled();
    expect(usePreparation.getState().jobs[0]).toMatchObject({ status: "ready", done: 2 });
    expect(generated).toEqual(["First a.", "Second a."]);
  });

  it("cancels a reading waiting for reconnection and advances the queue", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new TypeError("Server restarted"));
    usePreparation.getState().enqueue([record("a"), record("b")], [bella]);
    await vi.waitFor(() => expect(usePreparation.getState().jobs[0].message).toContain("reconnect"));
    usePreparation.getState().cancel(usePreparation.getState().jobs[0].id);
    await settled();
    expect(usePreparation.getState().jobs.map((j) => j.status)).toEqual(["cancelled", "ready"]);
    expect(synthesize).toHaveBeenCalledTimes(3);
  });

  it("reports a failed reading and continues preparing the next one", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new Error("Server refused"));
    usePreparation.getState().enqueue([record("a"), record("b")], [bella]);
    await settled();
    expect(usePreparation.getState().jobs.map((j) => [j.status, j.message])).toEqual([["error", "Server refused"], ["ready", undefined]]);
  });

  it("does not claim success when audio could not be saved", async () => {
    vi.mocked(synthesize).mockResolvedValue({ source: "api", audio: new Blob(["audio"]), duration: 1 });
    usePreparation.getState().enqueue([record("a")], [bella]);
    await settled();
    expect(usePreparation.getState().jobs[0]).toMatchObject({ status: "error", done: 0, message: expect.stringContaining("storage") });
  });

  it("cancels active and queued jobs for a removed document without stopping other documents", async () => {
    vi.mocked(synthesize).mockImplementationOnce((req) => new Promise((_, reject) => {
      req.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    usePreparation.getState().enqueue([record("a"), record("b")], [bella, jasper]);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
    usePreparation.getState().cancelDocument("a");
    await docs.delete("a");
    await settled();
    expect(usePreparation.getState().jobs.map((j) => j.status)).toEqual(["cancelled", "cancelled", "ready", "ready"]);
    expect(await docs.get("a")).toBeUndefined();
  });

  it("saves a Patois adaptation without changing a document's selected voice", async () => {
    vi.mocked(preparePatois).mockImplementationOnce(async (rec) => ({ ...rec, patois: { sourceText: rec.text, text: "Wah gwaan.", version: 1 } }));
    usePreparation.getState().enqueue([record("a")], [FISH_PRESET_VOICES.find((v) => v.id === JAMAICAN_PATOIS_VOICE_ID)!]);
    await settled();
    expect(await docs.get("a")).toMatchObject({ voice: null, patois: { text: "Wah gwaan." } });
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: "Wah gwaan.", voice: JAMAICAN_PATOIS_VOICE_ID }));
    expect(prepareInBackground).not.toHaveBeenCalled();
  });
});
