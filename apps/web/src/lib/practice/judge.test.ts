import { describe, expect, it, vi } from "vitest";
import { interpretJudgement, judgeRequest, verdictOf, wordRequest } from "./judge";
import { tokens } from "./words";

const PASSAGE = "I was born in Tuckahoe, near Hillsborough, and about twelve miles from Easton.";
const AUDIO = { data: "UklGRg==", format: "wav" as const };

describe("tokens", () => {
  it("keeps punctuation outside the word", () => {
    expect(tokens('"Tuckahoe," he said—quietly.').map((t) => [t.pre, t.word, t.post, t.space])).toEqual([
      ['"', "Tuckahoe", ',"', true], ["", "he", "", true], ["", "said", "—", true], ["", "quietly", ".", false],
    ]);
    expect(tokens("a — b").map((t) => t.word)).toEqual(["a", "—", "b"]);
    expect(tokens("his orphan--to do").map((t) => `${t.word}${t.post}`)).toEqual(["his", "orphan—", "to", "do"]);
  });
});

describe("judgeRequest", () => {
  it("asks about every word, with context, plus phrasing, expression, pace and off-script", () => {
    const request = judgeRequest(PASSAGE, AUDIO);
    expect(request.model).toBe("gemini-decision-1");
    const keys = Object.keys(request.questions);
    expect(keys.filter((k) => k.startsWith("w_"))).toHaveLength(13);
    expect(keys).toEqual(expect.arrayContaining(["phrasing", "expression", "pace", "off_script"]));
    const q = request.questions.w_4 as { instructions: string; criteria: Record<string, string> };
    expect(q.instructions).toContain('"Tuckahoe"');
    expect(q.instructions).toContain("in [Tuckahoe] near");
    expect(Object.keys(q.criteria)).toEqual(["correct", "mispronounced", "substituted", "skipped"]);
    expect(request.state[1]).toEqual({ type: "input_audio", input_audio: AUDIO });
    expect((request.state[0] as { text: string }).text).toContain(PASSAGE);
  });

  it("asks one question for a single word", () => {
    expect(Object.keys(wordRequest("authentic", AUDIO).questions)).toEqual(["w"]);
  });
});

describe("verdicts", () => {
  it("turns a low-confidence miss into unsure but keeps a low-confidence correct", () => {
    expect(verdictOf({ choice: "substituted", confidence: 0.92 })).toEqual({ verdict: "substituted", confidence: 0.92 });
    expect(verdictOf({ choice: "skipped", confidence: 0.55 }).verdict).toBe("unsure");
    expect(verdictOf({ choice: "correct", confidence: 0.55 }).verdict).toBe("correct");
    expect(verdictOf({ choice: "made-up", confidence: 0.99 }).verdict).toBe("unsure");
    expect(verdictOf(undefined).verdict).toBe("unsure");
  });

  it("reads levels and the off-script flag", () => {
    const answers: Record<string, unknown> = Object.fromEntries(tokens(PASSAGE).map((t) => [`w_${t.index}`, { choice: "correct", confidence: 0.95 }]));
    answers.w_4 = { choice: "mispronounced", confidence: 0.81 };
    answers.phrasing = { score: 2.2 };
    answers.expression = { score: 0.9 };
    answers.pace = { score: 2 };
    answers.off_script = { noul: 0.02 };
    const j = interpretJudgement(PASSAGE, { answers: answers as never });
    expect(j.words[4]).toMatchObject({ word: "Tuckahoe", post: ",", verdict: "mispronounced" });
    expect([j.phrasing, j.expression, j.pace, j.offScript]).toEqual([3, 2, 3, false]);
    expect(interpretJudgement(PASSAGE, { answers: { ...answers, off_script: { noul: 0.9 } } as never }).offScript).toBe(true);
  });

  it("refuses answers that don't match the passage", () => {
    expect(() => interpretJudgement(PASSAGE, {})).toThrow(/no answers/);
    expect(() => interpretJudgement(PASSAGE, { answers: { phrasing: { score: 1 } } })).toThrow(/didn't match/);
  });
});

describe("askJudge", () => {
  it("explains OpenCode's billing refusal and a missing key", async () => {
    const { askJudge, JudgeNotConfigured } = await import("./judge");
    const reply = (status: number) => vi.fn(async () => Response.json({ error: { message: "raw" } }, { status }));
    vi.stubGlobal("fetch", reply(402));
    await expect(askJudge({})).rejects.toThrow(/Gemini API key in Settings → Practice/);
    vi.stubGlobal("fetch", reply(503));
    await expect(askJudge({})).rejects.toBeInstanceOf(JudgeNotConfigured);
    vi.unstubAllGlobals();
  });
});
