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

  it("tells chapters only being copied onto the device apart from ones still being made", () => {
    const [tally] = shelfPreparation([
      { id: "made", duration: 100, prepared: [{ ...bella, fraction: 1 }] },
      { id: "downloading", duration: 100, prepared: [{ ...bella, fraction: 0.4 }] },
      { id: "new", duration: 100, prepared: [] },
    ], [job("made", 0, 10), { ...job("downloading", 10, 10), status: "saving" }, job("new", 2, 10)]);
    expect(tally.busy).toBe(3);
    expect(tally.saving).toBe(2);
  });

  it("measures what is stored on this device apart from what is made", () => {
    const [tally] = shelfPreparation([
      { id: "made", duration: 100, prepared: [{ ...bella, fraction: 1 }] },
      { id: "downloading", duration: 100, prepared: [{ ...bella, fraction: 0.2 }] },
      { id: "waiting", duration: 200, prepared: [] },
    ], [{ ...job("downloading", 10, 10), status: "saving", step: { done: 6, total: 10 } }, { ...job("waiting", 10, 10), status: "saving" }]);
    expect(tally.fraction).toBe(1);
    // made: 100 of 400; downloading: 6 of 10 passages stored, ahead of the library's last read; waiting: nothing yet
    expect(tally.saved).toBeCloseTo((100 + 60) / 400);
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
