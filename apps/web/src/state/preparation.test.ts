import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JAMAICAN_PATOIS_VOICE_ID, FISH_PRESET_VOICES, OPENAI_VOICES, PRESET_VOICES } from "../data/voices";
import { cacheKey, prepareInBackground, synthesize } from "../engine/providers";
import { audioCache, db, docs, type DocRecord } from "../lib/db";
import { preparePatois } from "../lib/patois";
import { isPreparing, PREPARATION_CONCURRENCY, usePreparation } from "./preparation";

vi.mock("../engine/providers", async (original) => ({ ...await original<typeof import("../engine/providers")>(), synthesize: vi.fn(), prepareInBackground: vi.fn() }));
vi.mock("../lib/patois", async (original) => ({ ...await original<typeof import("../lib/patois")>(), preparePatois: vi.fn() }));
const [bella, jasper] = PRESET_VOICES;
const record = (id: string): DocRecord => ({ id, title: id, text: `First ${id}.\n\nSecond ${id}.`, voice: null, chars: 20, source: "paste", domain: "Text", createdAt: 0, updatedAt: 0 });
const settled = async () => vi.waitFor(() => expect(usePreparation.getState().jobs.some(isPreparing)).toBe(false));
function holdBackgroundJobs() {
  const pending: { signal: AbortSignal; release: () => void }[] = [];
  vi.mocked(prepareInBackground).mockImplementation((_requests, _start, _progress, signal) => new Promise<void>((resolve) => {
    const release = () => { signal!.removeEventListener("abort", release); resolve(); };
    pending.push({ signal: signal!, release });
    if (signal!.aborted) release();
    else signal!.addEventListener("abort", release, { once: true });
  }));
  return pending;
}

beforeEach(async () => {
  vi.resetAllMocks();
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
  it("starts bounded concurrent readings and fills a slot as soon as one finishes", async () => {
    const pending = holdBackgroundJobs();
    usePreparation.getState().enqueue([record("a"), record("b")], [bella, jasper]);
    await vi.waitFor(() => expect(pending).toHaveLength(PREPARATION_CONCURRENCY));
    expect(usePreparation.getState().jobs.map((job) => job.status)).toEqual(["preparing", "preparing", "preparing", "queued"]);
    expect(usePreparation.getState().enqueue([record("a")], [bella])).toBe(0);
    pending[0].release();
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    expect(usePreparation.getState().jobs[0].status).toBe("ready");
    pending.forEach((job) => job.release());
    await settled();
    expect(usePreparation.getState().jobs.every((job) => job.status === "ready")).toBe(true);
  });

  it("prepares cloud voices even when all VoiceStudio slots are occupied", async () => {
    const pending = holdBackgroundJobs();
    usePreparation.getState().enqueue([record("a"), record("b")], [bella, jasper]);
    await vi.waitFor(() => expect(pending).toHaveLength(PREPARATION_CONCURRENCY));
    usePreparation.getState().enqueue([record("a")], [OPENAI_VOICES[0], FISH_PRESET_VOICES[0]]);
    await vi.waitFor(() => expect(usePreparation.getState().jobs.slice(4).map((job) => job.status)).toEqual(["ready", "ready"]));
    expect(pending).toHaveLength(PREPARATION_CONCURRENCY);
    usePreparation.getState().cancelAll();
    await settled();
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
    const pending = holdBackgroundJobs();
    usePreparation.getState().enqueue([record("a"), record("b")], [bella, jasper]);
    await vi.waitFor(() => expect(pending).toHaveLength(PREPARATION_CONCURRENCY));
    // b has one active and one queued voice; a has two active voices.
    usePreparation.getState().cancelDocument("b");
    await docs.delete("b");
    expect(pending.map((job) => job.signal.aborted)).toEqual([false, false, true]);
    pending.forEach((job) => job.release());
    await settled();
    expect(usePreparation.getState().jobs.map((j) => j.status)).toEqual(["ready", "ready", "cancelled", "cancelled"]);
    expect(await docs.get("b")).toBeUndefined();
    expect(prepareInBackground).toHaveBeenCalledTimes(PREPARATION_CONCURRENCY);
  });

  it("aborts every active reading on cancel all and allows new work afterwards", async () => {
    const pending = holdBackgroundJobs();
    usePreparation.getState().enqueue([record("a"), record("b")], [bella, jasper]);
    await vi.waitFor(() => expect(pending).toHaveLength(PREPARATION_CONCURRENCY));
    usePreparation.getState().cancelAll();
    expect(pending.every((job) => job.signal.aborted)).toBe(true);
    expect(usePreparation.getState().jobs.every((job) => job.status === "cancelled")).toBe(true);
    usePreparation.getState().enqueue([record("b")], [jasper]);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    pending[3].release();
    await settled();
    expect(usePreparation.getState().jobs.at(-1)?.status).toBe("ready");
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
