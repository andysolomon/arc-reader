import { describe, expect, it } from "vitest";
import { shelfPercent, shelfPreparation } from "./shelfPreparation";

const bella = { voiceId: "bella", name: "Bella", engine: "voicestudio" };
const job = (docId: string, done: number, total: number) => ({ docId, voice: { id: "bella", name: "Bella", engine: "voicestudio" }, done, total });

describe("shelfPreparation", () => {
  it("weights chapters by how long they read", () => {
    const [tally] = shelfPreparation([
      { id: "preface", duration: 60, prepared: [{ ...bella, fraction: 1 }] },
      { id: "one", duration: 540, prepared: [] },
    ], []);
    expect(tally.fraction).toBeCloseTo(0.1);
    expect(tally.complete).toBe(1);
    expect(tally.chapters).toBe(2);
    expect(shelfPercent(tally)).toBe(10);
  });

  it("counts a chapter being made by its generated passages, but never below what is saved", () => {
    const [tally] = shelfPreparation([
      { id: "one", duration: 100, prepared: [{ ...bella, fraction: 0.8 }] },
      { id: "two", duration: 100, prepared: [] },
    ], [job("one", 1, 10), job("two", 5, 10)]);
    expect(tally.fraction).toBeCloseTo((0.8 + 0.5) / 2);
    expect(tally.busy).toBe(2);
    expect(tally.complete).toBe(0);
  });

  it("ignores queue entries for other documents and keeps voices apart", () => {
    const voices = shelfPreparation([
      { id: "one", duration: 100, prepared: [{ ...bella, fraction: 1 }, { voiceId: "jasper", name: "Jasper", engine: "voicestudio", fraction: 0.5 }] },
    ], [job("elsewhere", 5, 10)]);
    expect(voices.map((v) => [v.voice.voiceId, v.fraction, v.busy])).toEqual([["bella", 1, 0], ["jasper", 0.5, 0]]);
  });

  it("treats a chapter of unknown length as an average one", () => {
    const [tally] = shelfPreparation([
      { id: "one", duration: 0, prepared: [{ ...bella, fraction: 1 }] },
      { id: "two", duration: 200, prepared: [] },
    ], []);
    expect(tally.fraction).toBeCloseTo(0.5);
  });

  it("only says 100% when every chapter is done, and 0% only when nothing is", () => {
    expect(shelfPercent({ fraction: 0.999, complete: 9, chapters: 10 })).toBe(99);
    expect(shelfPercent({ fraction: 0.001, complete: 0, chapters: 10 })).toBe(1);
    expect(shelfPercent({ fraction: 0, complete: 0, chapters: 10 })).toBe(0);
    expect(shelfPercent({ fraction: 1, complete: 10, chapters: 10 })).toBe(100);
  });
});
