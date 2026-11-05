import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiUnreachable, type Chunk } from "./types";

const synthesize = vi.fn<(opts: { text: string }) => Promise<Chunk>>();
vi.mock("./providers", () => ({ synthesize: (opts: { text: string }) => synthesize(opts) }));

const { PlaybackEngine } = await import("./engine");

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const doc = {
  id: "d1", title: "T", voice: "v", lang: "en",
  sentences: [
    { text: "One two three.", words: ["One", "two", "three."] },
    { text: "Four five six.", words: ["Four", "five", "six."] },
  ],
  paragraphs: [{ start: 0, sentences: [{ text: "One two three.", words: ["One", "two", "three."] }, { text: "Four five six.", words: ["Four", "five", "six."] }] }],
};

function make() {
  const onUnavailable = vi.fn();
  const engine = new PlaybackEngine({
    engine: () => "kittentts",
    wordTimings: () => false,
    isProfileVoice: () => false,
    offline: () => false,
    onRejected: vi.fn(),
    onOffline: vi.fn(),
    onOnline: vi.fn(),
    onPersist: vi.fn(),
    onError: vi.fn(),
    onUnavailable,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine.load(doc as any);
  return { engine, onUnavailable };
}

describe("PlaybackEngine start-up", () => {
  beforeEach(() => {
    synthesize.mockReset();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not report playing until the first sentence's audio exists", async () => {
    const first = deferred<Chunk>();
    synthesize.mockReturnValueOnce(first.promise).mockResolvedValue({ source: "estimate", duration: 1 });
    const { engine } = make();
    const play = engine.play();
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ playing: false, loading: true, offset: 0 });
    first.resolve({ source: "estimate", duration: 2 });
    await play;
    expect(engine.getSnapshot()).toMatchObject({ playing: true, loading: false });
  });

  it("pausing while a sentence is generating cancels the start", async () => {
    const first = deferred<Chunk>();
    synthesize.mockReturnValueOnce(first.promise);
    const { engine } = make();
    const play = engine.play();
    await tick();
    engine.toggle();
    expect(engine.getSnapshot()).toMatchObject({ playing: false, loading: false });
    first.resolve({ source: "estimate", duration: 2 });
    await play;
    expect(engine.getSnapshot().playing).toBe(false);
  });

  it("stops and reports when the voice cannot be generated instead of substituting another voice", async () => {
    synthesize.mockRejectedValueOnce(new ApiUnreachable());
    const { engine, onUnavailable } = make();
    await engine.play();
    expect(engine.getSnapshot()).toMatchObject({ playing: false, loading: false });
    expect(onUnavailable).toHaveBeenCalledWith("Speech server unreachable.");
    expect(synthesize.mock.calls[0][0]).toMatchObject({ fallbackLocal: false });
    // A retry asks the server again rather than reusing the failed attempt.
    synthesize.mockResolvedValue({ source: "estimate", duration: 1 });
    await engine.play();
    expect(engine.getSnapshot().playing).toBe(true);
  });
});
