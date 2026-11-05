import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlaybackEngine, SLOW_FACTOR, type EngineDoc } from "./engine";
import { synthesize } from "./providers";
import { ApiUnreachable, type Chunk } from "./types";

vi.mock("./providers", () => ({ synthesize: vi.fn(), isPaidEngine: (e: string) => e === "openai" || e === "fish" }));
vi.stubGlobal("requestAnimationFrame", () => 0);
vi.stubGlobal("cancelAnimationFrame", () => {});

const synth = vi.mocked(synthesize);
/** `n` one-word sentences, each its own paragraph, so every sentence is its own passage. */
const doc = (n: number): EngineDoc => ({
  id: "d", title: "t", voice: "v", lang: "en",
  sentences: Array.from({ length: n }, (_, i) => ({ index: i, para: i, text: `s${i}`, words: [`s${i}`] })),
  paragraphs: [],
} as unknown as EngineDoc);
/** Sentences grouped into paragraphs by the given sizes: [2, 1] → "s0 s1" then "s2". */
const paraDoc = (sizes: number[]): EngineDoc => {
  const sentences = sizes.flatMap((size, para) => Array.from({ length: size }, (_, k) => ({ para, text: `p${para}s${k}.`, words: [`p${para}s${k}.`] })));
  return { id: "d", title: "t", voice: "v", lang: "en", sentences: sentences.map((x, index) => ({ ...x, index })), paragraphs: [] } as unknown as EngineDoc;
};
const chunk = (extra: Partial<Chunk> = {}): Chunk => ({ source: "api", audio: new Blob([new Uint8Array(4)]), duration: 2, ...extra });

function make(onSlow = vi.fn(), onUnavailable = vi.fn(), engineId = "omnivoice") {
  const e = new PlaybackEngine({
    engine: () => engineId, wordTimings: () => false, isProfileVoice: () => true, offline: () => false,
    onRejected: () => {}, onOffline: () => {}, onOnline: () => {}, onPersist: () => {}, onError: () => {}, onSlow, onUnavailable,
  });
  return { e, onSlow, onUnavailable };
}

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

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

describe("passages", () => {
  it("requests one clip per paragraph, with the words of every sentence for alignment", async () => {
    synth.mockImplementation(async () => chunk());
    const { e } = make();
    e.load(paraDoc([3, 2]));
    expect(e.passages.map((p) => [p.start, p.end])).toEqual([[0, 3], [3, 5]]);
    await e.prepare();
    expect(synth).toHaveBeenCalledTimes(2);
    expect(synth.mock.calls[0][0]).toMatchObject({ text: "p0s0. p0s1. p0s2.", words: ["p0s0.", "p0s1.", "p0s2."], parts: [["p0s0."], ["p0s1."], ["p0s2."]] });
    expect(synth.mock.calls[1][0]).toMatchObject({ text: "p1s0. p1s1." });
  });

  it("prepares from the passage holding the current sentence and reports passage counts", async () => {
    synth.mockImplementation(async () => chunk());
    const { e } = make();
    e.load(paraDoc([2, 2, 1]), 3);
    const progress: [number, number][] = [];
    await e.prepare((done, total) => progress.push([done, total]));
    expect(synth.mock.calls.map((c) => c[0].text)).toEqual(["p1s0. p1s1.", "p2s0.", "p0s0. p0s1."]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("splits sentence durations by the clip's sentence starts, so the progress bar and seeking follow the audio", async () => {
    synth.mockResolvedValueOnce(chunk({ duration: 10, starts: [0, 4, 7] })).mockResolvedValue(chunk({ duration: 3 }));
    const { e } = make();
    e.load(paraDoc([3, 1]));
    await e.prepare();
    const snap = e.getSnapshot();
    expect(snap.total).toBeCloseTo(13);
    expect(snap.ticks.map((t) => +(t * 13).toFixed(3))).toEqual([4, 7, 10]);
    e.seekFraction(5 / 13, false);
    expect(e.getSnapshot()).toMatchObject({ index: 1, offset: 1 });
  });

  it("waits for the whole passage before reporting playing, even mid-paragraph", async () => {
    const first = deferred<Chunk>();
    synth.mockReturnValueOnce(first.promise).mockResolvedValue(chunk({ source: "estimate", audio: undefined, duration: 1 }));
    const { e } = make();
    e.load(paraDoc([3]), 1);
    const play = e.play();
    await tick();
    expect(e.getSnapshot()).toMatchObject({ playing: false, loading: true, index: 1 });
    first.resolve(chunk({ source: "estimate", audio: undefined, duration: 3, starts: [0, 1, 2] }));
    await play;
    expect(e.getSnapshot()).toMatchObject({ playing: true, loading: false, index: 1 });
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

describe("start-up", () => {
  it("does not report playing until the first sentence's audio exists", async () => {
    const first = deferred<Chunk>();
    synth.mockReturnValueOnce(first.promise).mockResolvedValue(chunk({ source: "estimate", audio: undefined, duration: 1 }));
    const { e } = make();
    e.load(doc(2));
    const play = e.play();
    await tick();
    expect(e.getSnapshot()).toMatchObject({ playing: false, loading: true, offset: 0 });
    first.resolve(chunk({ source: "estimate", audio: undefined }));
    await play;
    expect(e.getSnapshot()).toMatchObject({ playing: true, loading: false });
  });

  it("pausing while a sentence is generating cancels the start", async () => {
    const first = deferred<Chunk>();
    synth.mockReturnValueOnce(first.promise);
    const { e } = make();
    e.load(doc(1));
    const play = e.play();
    await tick();
    e.toggle();
    expect(e.getSnapshot()).toMatchObject({ playing: false, loading: false });
    first.resolve(chunk({ source: "estimate", audio: undefined }));
    await play;
    expect(e.getSnapshot().playing).toBe(false);
  });

  it("stops and reports when the voice cannot be generated instead of substituting another voice", async () => {
    synth.mockRejectedValueOnce(new ApiUnreachable());
    const { e, onUnavailable } = make();
    e.load(doc(2));
    await e.play();
    expect(e.getSnapshot()).toMatchObject({ playing: false, loading: false });
    expect(onUnavailable).toHaveBeenCalledWith("Speech server unreachable.");
    expect(synth.mock.calls[0][0]).toMatchObject({ fallbackLocal: false });
    // A retry asks the server again rather than reusing the failed attempt.
    synth.mockResolvedValue(chunk({ source: "estimate", audio: undefined, duration: 1 }));
    await e.play();
    expect(e.getSnapshot().playing).toBe(true);
  });
});

describe("prefetch", () => {
  const ahead = async (engineId: string) => {
    synth.mockResolvedValue(chunk({ source: "estimate", audio: undefined, duration: 1 }));
    const { e } = make(vi.fn(), vi.fn(), engineId);
    e.load(doc(5));
    await e.play();
    return synth.mock.calls.map((c) => c[0].text);
  };

  it("keeps two passages ahead on a local server", async () => {
    expect(await ahead("omnivoice")).toEqual(["s0", "s1", "s2"]);
  });

  it("keeps one passage ahead on a paid engine, so a pause or skip bills less unheard audio", async () => {
    expect(await ahead("openai")).toEqual(["s0", "s1"]);
    synth.mockReset();
    expect(await ahead("fish")).toEqual(["s0", "s1"]);
  });

  it("passes each sentence's text so a passage can reuse clips cached sentence by sentence", async () => {
    synth.mockResolvedValue(chunk({ source: "estimate", audio: undefined, duration: 1 }));
    const { e } = make();
    e.load(paraDoc([2]));
    await e.play();
    expect(synth.mock.calls[0][0]).toMatchObject({ text: "p0s0. p0s1.", sentences: ["p0s0.", "p0s1."] });
  });
});
