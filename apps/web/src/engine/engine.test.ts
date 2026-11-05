import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlaybackEngine, SLOW_FACTOR, type EngineDoc } from "./engine";
import { synthesize } from "./providers";
import type { Chunk } from "./types";

vi.mock("./providers", () => ({ synthesize: vi.fn() }));
vi.stubGlobal("requestAnimationFrame", () => 0);
vi.stubGlobal("cancelAnimationFrame", () => {});

const synth = vi.mocked(synthesize);
const doc = (n: number): EngineDoc => ({
  id: "d", title: "t", voice: "v", lang: "en",
  sentences: Array.from({ length: n }, (_, i) => ({ text: `s${i}`, words: [`s${i}`], start: i, end: i + 1 })),
  words: n,
} as unknown as EngineDoc);
const chunk = (extra: Partial<Chunk> = {}): Chunk => ({ source: "api", audio: new Blob([new Uint8Array(4)]), duration: 2, ...extra });

function make(onSlow = vi.fn()) {
  const e = new PlaybackEngine({
    engine: () => "omnivoice", wordTimings: () => false, isProfileVoice: () => true, offline: () => false,
    onRejected: () => {}, onOffline: () => {}, onOnline: () => {}, onPersist: () => {}, onError: () => {}, onSlow,
  });
  return { e, onSlow };
}

beforeEach(() => synth.mockReset());

describe("prepare", () => {
  it("renders from the current sentence to the end, then the start, reporting progress", async () => {
    synth.mockImplementation(async () => chunk());
    const { e } = make();
    e.load(doc(4), 2);
    const progress: number[] = [];
    await e.prepare((done) => progress.push(done));
    expect(synth.mock.calls.map((c) => c[0].text)).toEqual(["s2", "s3", "s0", "s1"]);
    expect(progress).toEqual([1, 2, 3, 4]);
    // Already-rendered sentences are reused, not requested again.
    await e.prepare();
    expect(synth).toHaveBeenCalledTimes(4);
  });

  it("stops when aborted or when another document is loaded", async () => {
    synth.mockImplementation(async () => chunk());
    const { e } = make();
    e.load(doc(3));
    const controller = new AbortController();
    const run = e.prepare((done) => { if (done === 1) controller.abort(); }, controller.signal);
    await run;
    expect(synth).toHaveBeenCalledTimes(1);

    synth.mockClear();
    e.load(doc(3));
    const swap = e.prepare((done) => { if (done === 1) e.load(doc(2)); });
    await swap;
    expect(synth).toHaveBeenCalledTimes(1);
  });
});

describe("slow voice detection", () => {
  it("reports once per load when rendering takes longer than playback", async () => {
    synth.mockImplementation(async () => chunk({ renderSeconds: 2 * SLOW_FACTOR * 10 }));
    const { e, onSlow } = make();
    e.load(doc(2));
    await e.prepare();
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSlow).toHaveBeenCalledWith(SLOW_FACTOR * 10);
    e.load(doc(1));
    await e.prepare();
    expect(onSlow).toHaveBeenCalledTimes(2);
  });

  it("ignores fast and cached chunks", async () => {
    synth.mockResolvedValueOnce(chunk({ renderSeconds: 1 })).mockResolvedValueOnce(chunk({ source: "cache" }));
    const { e, onSlow } = make();
    e.load(doc(2));
    await e.prepare();
    expect(onSlow).not.toHaveBeenCalled();
  });
});
