import { describe, expect, it } from "vitest";
import { daysBetween, feedback, scoreReading } from "./score";
import type { Judgement, Verdict } from "./judge";

const judgement = (verdicts: Verdict[], pace = 3): Judgement => ({
  words: verdicts.map((verdict, index) => ({ index, pre: "", word: `w${index}`, post: "", space: true, verdict })),
  prosody: { phrasing: 3, expression: 2, pace }, offScript: false,
});

describe("scoreReading", () => {
  it("matches the design's sample: 70 words, one unsure, 66 of 69 correct in 28 s", () => {
    const verdicts: Verdict[] = [...Array(66).fill("correct"), "mispronounced", "substituted", "skipped", "unsure"];
    const s = scoreReading(judgement(verdicts), 28);
    expect([s.correct, s.counted, s.unsure, s.accuracy, s.wcpm, s.points, s.missed.length]).toEqual([66, 69, 1, 96, 141, 66, 3]);
    expect(feedback(s, 3)).toBe("Clear, steady reading. Three words to practise.");
  });

  it("handles silence and perfect reads", () => {
    expect(scoreReading(judgement(["unsure"]), 0)).toMatchObject({ accuracy: 0, wcpm: 0 });
    const perfect = scoreReading(judgement(Array(50).fill("correct")), 20);
    expect(feedback(perfect, 3)).toMatch(/Every word landed/);
    expect(feedback(scoreReading(judgement([...Array(19).fill("correct"), "skipped"]), 20), 2)).toBe("Clear reading, a little slow. One word to practise.");
  });
});

describe("daysBetween", () => {
  it("counts calendar days across month ends", () => {
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-11-14", "2026-11-14")).toBe(0);
  });
});
