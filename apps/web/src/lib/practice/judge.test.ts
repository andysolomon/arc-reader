import { afterEach, describe, expect, it, vi } from "vitest";
import { askJudge, hearTake, interpretProsody, JudgeNotConfigured, judgeReading, prosodyRequest, type Transcriber } from "./judge";
import { tokens } from "./words";

const PASSAGE = "I was born in Tuckahoe, near Hillsborough, and about twelve miles from Easton.";
const AUDIO = { data: "UklGRg==", format: "wav" as const };
const WAV = new Blob(["RIFF"], { type: "audio/wav" });
const TAKE = { wav: WAV, audio: AUDIO, duration: 6, speech: 5 };

afterEach(() => vi.unstubAllGlobals());

describe("tokens", () => {
  it("keeps punctuation outside the word", () => {
    expect(tokens('"Tuckahoe," he said—quietly.').map((t) => [t.pre, t.word, t.post, t.space])).toEqual([
      ['"', "Tuckahoe", ',"', true], ["", "he", "", true], ["", "said", "—", true], ["", "quietly", ".", false],
    ]);
    expect(tokens("a — b").map((t) => t.word)).toEqual(["a", "—", "b"]);
    expect(tokens("his orphan--to do").map((t) => `${t.word}${t.post}`)).toEqual(["his", "orphan—", "to", "do"]);
  });
});

describe("prosody", () => {
  it("asks Gemini only how the passage was read", () => {
    const request = prosodyRequest(PASSAGE, AUDIO);
    expect(request.model).toBe("gemini-decision-1");
    expect(Object.keys(request.questions)).toEqual(["phrasing", "expression", "pace"]);
    expect(request.state[1]).toEqual({ type: "input_audio", input_audio: AUDIO });
    expect((request.state[0] as { text: string }).text).toContain(PASSAGE);
  });

  it("reads levels and refuses missing answers", () => {
    expect(interpretProsody({ answers: { phrasing: { score: 2.2 }, expression: { score: 0.9 }, pace: { score: 2 } } })).toEqual({ phrasing: 3, expression: 2, pace: 3 });
    expect(() => interpretProsody({ answers: { phrasing: { score: 1 } } })).toThrow(/no answer/);
  });
});

describe("hearTake", () => {
  it("uses one fast transcript when it covers the passage", async () => {
    const transcribe = vi.fn<Transcriber>(async () => "I was born in Tuckahoe near Hillsborough and about 12 miles from Boston");
    // A misheard name is given the benefit of the doubt.
    const hearing = await hearTake(PASSAGE, WAV, undefined, transcribe);
    expect(transcribe.mock.calls.map((c) => c[1])).toEqual(["fast"]);
    expect(hearing.words.filter((w) => w.verdict !== "correct").map((w) => [w.word, w.verdict, w.heard])).toEqual([["Easton", "unsure", "boston"]]);
  });

  it("asks for a slower transcript when the fast one dropped a stretch, and survives its failure", async () => {
    const dropped = "and about twelve miles from Easton";
    const transcribe = vi.fn<Transcriber>(async (_wav, mode) => mode === "fast" ? dropped : "I was born in Tuckahoe near Hillsborough and about twelve miles from Easton");
    const hearing = await hearTake(PASSAGE, WAV, undefined, transcribe);
    expect(transcribe.mock.calls.map((c) => c[1])).toEqual(["fast", "accurate"]);
    expect(hearing.matched).toBe(1);
    const failing = vi.fn<Transcriber>(async (_wav, mode) => { if (mode === "accurate") throw new Error("busy"); return dropped; });
    expect((await hearTake(PASSAGE, WAV, undefined, failing)).words.filter((w) => w.verdict === "skipped")).toHaveLength(7);
  });
});

describe("judgeReading", () => {
  const stub = (decide: () => Response, transcript = "I was born in Tuckahoe near Hillsborough and about twelve miles Easton") =>
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/api/decide/") ? decide() : Response.json({ text: transcript })));

  it("combines the transcript's words with Gemini's levels", async () => {
    stub(() => Response.json({ answers: { phrasing: { score: 2 }, expression: { score: 1 }, pace: { score: 2 } } }));
    const j = await judgeReading(PASSAGE, TAKE);
    expect(j.words.filter((w) => w.verdict !== "correct").map((w) => [w.word, w.verdict])).toEqual([["from", "skipped"]]);
    expect(j.prosody).toEqual({ phrasing: 3, expression: 2, pace: 3 });
    expect(j.offScript).toBe(false);
  });

  it("still scores the words when Gemini has no key or fails", async () => {
    stub(() => Response.json({ error: { message: "no key" } }, { status: 503 }));
    expect(await judgeReading(PASSAGE, TAKE)).toMatchObject({ prosody: null, prosodyIssue: "no-key", offScript: false });
    stub(() => Response.json({ error: { message: "quota" } }, { status: 429 }));
    expect((await judgeReading(PASSAGE, TAKE)).prosodyIssue).toMatch(/limit/);
  });

  it("calls a take that isn't the passage off-script", async () => {
    stub(() => Response.json({ answers: { phrasing: { score: 2 }, expression: { score: 1 }, pace: { score: 2 } } }), "Thank you for watching.");
    expect((await judgeReading(PASSAGE, TAKE)).offScript).toBe(true);
  });

  it("fails when the speech server can't transcribe", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/api/decide/")
      ? Response.json({ answers: { phrasing: { score: 2 }, expression: { score: 1 }, pace: { score: 2 } } })
      : Response.json({ detail: "ASR model missing" }, { status: 409 })));
    await expect(judgeReading(PASSAGE, TAKE)).rejects.toThrow(/speech server couldn't check the reading: ASR model missing/);
  });
});

describe("askJudge", () => {
  it("explains OpenCode's billing refusal and a missing key", async () => {
    const reply = (status: number) => vi.fn(async () => Response.json({ error: { message: "raw" } }, { status }));
    vi.stubGlobal("fetch", reply(402));
    await expect(askJudge({})).rejects.toThrow(/Gemini API key in Settings → Practice/);
    vi.stubGlobal("fetch", reply(503));
    await expect(askJudge({})).rejects.toBeInstanceOf(JudgeNotConfigured);
  });
});
