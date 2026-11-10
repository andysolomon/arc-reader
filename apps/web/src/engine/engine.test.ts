import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function make(onSlow = vi.fn(), onUnavailable = vi.fn(), engineId = "omnivoice", prepareAudio?: ConstructorParameters<typeof PlaybackEngine>[0]["prepareAudio"]) {
  const onPersist = vi.fn();
  const onError = vi.fn();
  const e = new PlaybackEngine({
    engine: () => engineId, wordTimings: () => false, isProfileVoice: () => true, offline: () => false, prepareAudio,
    onRejected: () => {}, onOffline: () => {}, onOnline: () => {}, onPersist, onError, onSlow, onUnavailable,
  });
  return { e, onSlow, onUnavailable, onPersist, onError };
}

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// A block body: a function returned from beforeEach would run as a cleanup hook.
beforeEach(() => { synth.mockReset(); });

describe("prepared audio playback", () => {
  let gesture = false;
  let frames: FrameRequestCallback[];
  let elements: TestAudio[];
  class TestAudio {
    src = "";
    currentTime = 0;
    duration = 10;
    readyState = 2;
    paused = true;
    ended = false;
    preload = "";
    playbackRate = 1;
    volume = 1;
    onloadedmetadata: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeupdate: (() => void) | null = null;
    private allowed = false;
    constructor(src = "") { this.src = src; elements.push(this); }
    play = vi.fn(async () => {
      // Model browsers that grant playback permission to the element the user started.
      if (gesture) this.allowed = true;
      if (!this.allowed) throw new DOMException("User gesture required", "NotAllowedError");
      this.paused = false;
    });
    pause() { this.paused = true; }
    removeAttribute(name: string) { if (name === "src") this.src = ""; }
    load() { this.currentTime = 0; this.ended = false; }
    finish() { this.paused = true; this.ended = true; this.onended?.(); }
  }

  beforeEach(() => {
    elements = [];
    frames = [];
    gesture = true;
    vi.stubGlobal("Audio", TestAudio);
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => frames.push(fn));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    synth.mockResolvedValue(chunk({ source: "cache", duration: 10 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("plays every prepared passage without requiring another gesture or animation frames", async () => {
    const { e, onError } = make();
    e.load(doc(3));
    await e.prepare();
    await e.play();
    gesture = false;
    for (let index = 1; index < 3; index++) {
      elements.at(-1)!.finish();
      await tick();
      expect(e.getSnapshot()).toMatchObject({ playing: true, index, ended: false });
    }
    elements.at(-1)!.finish();
    expect(e.getSnapshot()).toMatchObject({ playing: false, index: 2, ended: true, fraction: 1 });
    expect(onError).not.toHaveBeenCalled();
    expect(synth).toHaveBeenCalledTimes(3);
    expect(elements).toHaveLength(1);
    e.unload();
  });

  it("trims trailing silence and keeps sentence position in the background without animation frames", async () => {
    synth.mockResolvedValueOnce(chunk({ source: "cache", duration: 10, starts: [0, 2], tail: 6 }))
      .mockResolvedValue(chunk({ source: "cache", duration: 10 }));
    const { e } = make();
    e.load(paraDoc([2, 1]));
    await e.prepare();
    await e.play();
    const audio = elements[0];
    audio.currentTime = 3;
    audio.ontimeupdate?.();
    expect(e.getSnapshot()).toMatchObject({ index: 1, offset: 1 });
    gesture = false;
    audio.currentTime = 4.3;
    audio.ontimeupdate?.();
    await tick();
    expect(e.getSnapshot()).toMatchObject({ index: 2, playing: true });
    e.unload();
  });

  it("freezes progress while the audio element is buffering", async () => {
    const { e } = make();
    e.load(doc(1));
    await e.play();
    elements[0].readyState = 1;
    frames.at(-1)!(performance.now() + 1000);
    expect(e.getSnapshot().offset).toBe(0);
    e.unload();
  });

  it("saves the actual audio position when paused between animation frames", async () => {
    synth.mockResolvedValue(chunk({ source: "cache", duration: 10, starts: [0, 4] }));
    const { e, onPersist } = make();
    e.load(paraDoc([2]));
    await e.play();
    elements[0].currentTime = 6;
    e.pause();
    expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1, offset: 2, playing: false }));
    e.unload();
  });

  it("stops at an unread passage on a media error instead of skipping it", async () => {
    const { e, onError } = make();
    e.load(doc(3));
    await e.prepare();
    await e.play();
    elements[0].onerror?.();
    await tick();
    expect(e.getSnapshot()).toMatchObject({ index: 0, playing: false, ended: false });
    expect(onError).toHaveBeenCalledWith("Audio playback failed. Tap play to retry.");
    e.unload();
  });
});

describe("prepare", () => {
  it("submits the entire document to the server before downloading its clips", async () => {
    const job = deferred<void>();
    const prepareAudio = vi.fn<NonNullable<ConstructorParameters<typeof PlaybackEngine>[0]["prepareAudio"]>>(() => job.promise);
    synth.mockResolvedValue(chunk());
    const { e } = make(undefined, undefined, "omnivoice", prepareAudio);
    e.load(doc(3), 1);
    const run = e.prepare();
    expect(prepareAudio.mock.calls[0][0].map((r) => r.text)).toEqual(["s0", "s1", "s2"]);
    expect(prepareAudio.mock.calls[0][1]).toBe(1);
    expect(synth).not.toHaveBeenCalled();
    job.resolve();
    await run;
    expect(synth).toHaveBeenCalledTimes(3);
  });

  it("reports generation errors instead of claiming success", async () => {
    synth.mockRejectedValueOnce(new ApiUnreachable());
    const { e } = make();
    e.load(doc(2));
    const progress = vi.fn();
    await expect(e.prepare(progress)).rejects.toBeInstanceOf(ApiUnreachable);
    expect(progress).not.toHaveBeenCalled();
  });
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

it("saves the current reading position immediately on pause, before navigation can unload the page", () => {
  const { e, onPersist } = make();
  e.load(doc(3));
  e.seek(1, false);
  e.pause();
  expect(onPersist).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  expect(onPersist.mock.calls[0][0].fraction).toBeCloseTo(1 / 3);
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

  /** Answers every request once the test lets it, so the refill order is observable. */
  function controlled() {
    const pending: { text: string; resolve: (c: Chunk) => void; reject: (e: unknown) => void }[] = [];
    synth.mockImplementation((req) => new Promise<Chunk>((resolve, reject) => pending.push({ text: req.text, resolve, reject })));
    return pending;
  }
  const estimate = (duration: number) => chunk({ source: "estimate", audio: undefined, duration });

  it("keeps about a minute of listening ahead, two requests at a time, not a fixed two passages", async () => {
    const pending = controlled();
    const { e } = make();
    e.load(doc(30));
    const play = e.play();
    pending.shift()!.resolve(estimate(10));
    await play;
    // The first two prefetches go out together.
    expect(pending.map((p) => p.text)).toEqual(["s1", "s2"]);
    while (pending.length) {
      pending.shift()!.resolve(estimate(10));
      await tick();
      expect(pending.length).toBeLessThanOrEqual(2);
    }
    // Ten-second passages: six cover a minute; the refill may run one past while a duration is still an estimate.
    const requested = synth.mock.calls.length - 1;
    expect(requested).toBeGreaterThanOrEqual(6);
    expect(requested).toBeLessThanOrEqual(7);
  });

  it("covers a minute at the current speed, so faster playback reads further ahead", async () => {
    const pending = controlled();
    const { e } = make();
    e.load(doc(30));
    e.setSpeed(2);
    const play = e.play();
    pending.shift()!.resolve(estimate(10));
    await play;
    while (pending.length) {
      pending.shift()!.resolve(estimate(10));
      await tick();
    }
    expect(synth.mock.calls.length - 1).toBeGreaterThanOrEqual(12);
  });

  it("stops refilling when a request fails instead of retrying in a loop", async () => {
    const pending = controlled();
    const { e } = make();
    e.load(doc(30));
    const play = e.play();
    pending.shift()!.resolve(estimate(10));
    await play;
    pending.shift()!.reject(new ApiUnreachable());
    pending.shift()!.reject(new ApiUnreachable());
    await tick();
    expect(pending).toHaveLength(0);
    expect(synth).toHaveBeenCalledTimes(3);
  });

  it("drops a previous document's refill after a load", async () => {
    const pending = controlled();
    const { e } = make();
    e.load(doc(30));
    const play = e.play();
    pending.shift()!.resolve(estimate(10));
    await play;
    const stale = pending.splice(0);
    e.load(doc(3));
    for (const p of stale) p.resolve(estimate(10));
    await tick();
    expect(pending).toHaveLength(0);
  });
});

describe("replacing a document's wording", () => {
  const withText = (d: EngineDoc, index: number, text: string): EngineDoc => ({
    ...d, sentences: d.sentences.map((s) => s.index === index ? { ...s, text, words: text.split(" ") } : s),
  });

  it("keeps the place and generates only the passages whose wording changed", async () => {
    const { e } = make();
    synth.mockResolvedValue(chunk({ source: "estimate", audio: undefined, duration: 1 }));
    const original = doc(3);
    e.load(original, 2);
    await e.collectAudio();
    expect(synth).toHaveBeenCalledTimes(3);
    synth.mockClear();

    expect(e.replaceText(withText(original, 1, "A chart of scores by harness"))).toBe(true);
    expect(e.getSnapshot().index).toBe(2);
    await e.collectAudio();
    expect(synth.mock.calls.map(([request]) => request.text)).toEqual(["A chart of scores by harness"]);
  });

  it("refuses wording that would move sentences or passages", () => {
    const { e } = make();
    const original = paraDoc([2, 1]);
    e.load(original);
    expect(e.replaceText(doc(3))).toBe(false);
    expect(e.replaceText({ ...original, id: "other" })).toBe(false);
    expect(e.replaceText(paraDoc([1, 1]))).toBe(false);
  });
});
