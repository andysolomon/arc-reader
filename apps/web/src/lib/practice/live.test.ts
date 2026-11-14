import { describe, expect, it } from "vitest";
import { alignPrefix } from "./align";
import { LIVE_START, advanceLive, type Segment } from "./live";
import { tokens } from "./words";

const PASSAGE = "I was born in Tuckahoe, near Hillsborough. I have no accurate knowledge of my age, never having seen any authentic record containing it. By far the larger part of the slaves know as little of their ages as horses know of theirs.";
const all = tokens(PASSAGE);
const seg = (start: number, end: number, text: string): Segment => ({ start, end, text });
const marks = (words: { word: string; verdict: string; heard?: string }[]) => words.filter((w) => w.verdict !== "correct").map((w) => [w.word, w.verdict, w.heard]);

describe("alignPrefix", () => {
  it("stops where the reading has got to, without calling the rest skipped", () => {
    const a = alignPrefix(all, "I was born in Tuckahoe near Hillsborough. I have no");
    expect(a.reach).toBe(10);
    expect(a.words.every((w) => w.kind === "correct")).toBe(true);
  });

  it("takes a trailing repeated word as the nearest one", () => {
    const words = tokens("She sat in the garden and the flower grew.");
    expect(alignPrefix(words, "she sat in the").reach).toBe(4);
    expect(alignPrefix(words, "she sat in the garden and the").reach).toBe(7);
  });

  it("takes a misread last word as that word, and finds skips before it", () => {
    const a = alignPrefix(all, "I was born in Tuckahoe near Hillsborough. I have no accurate music");
    expect(a.reach).toBe(12);
    expect(a.words[11]).toEqual({ kind: "misread", heard: "music", close: false });
    const b = alignPrefix(all, "I was in Tuckahoe");
    expect(b.reach).toBe(5);
    expect(b.words[2]).toEqual({ kind: "skipped" });
  });

  it("reaches nothing on silence", () => {
    expect(alignPrefix(all, "").reach).toBe(0);
  });
});

describe("advanceLive", () => {
  it("moves the cursor on an unfinished sentence without settling anything", () => {
    const s = advanceLive(LIVE_START, all, [seg(0, 3, "I was born in Tuckahoe near")]);
    expect(s.words).toEqual([]);
    expect(s.audioFrom).toBe(0);
    expect(s.cursor).toBe(4); // six words heard, two held back
  });

  it("settles every segment but the last, and starts the next transcript after them", () => {
    let s = advanceLive(LIVE_START, all, [seg(0, 4, "I was quickly in Tuckahoe, near Hillsborough."), seg(4.5, 6, "I have no accurate")]);
    expect(s.words).toHaveLength(7);
    expect(marks(s.words)).toEqual([["born", "substituted", "quickly"]]);
    expect(s.audioFrom).toBeCloseTo(3.4);
    expect(s.cursor).toBe(9);

    // The next transcript is of the audio from 3.4 s on, and its times start again at zero.
    s = advanceLive(s, all, [seg(0.2, 6.4, "I have no accurate knowledge of my age, never having any otnetic record containing it."), seg(7, 8, "By far the last time I was in the world.")]);
    expect(s.words).toHaveLength(23);
    expect(marks(s.words)).toEqual([["born", "substituted", "quickly"], ["seen", "skipped", undefined], ["authentic", "mispronounced", "otnetic"]]);
    expect(s.audioFrom).toBeCloseTo(3.4 + 6.4 - 0.6);
    // The invented ending of the unfinished sentence marks nothing.
    expect(s.cursor).toBe(24);
  });

  it("re-hears the end of the last sentence without marking anything, and leaves runs of missing words alone", () => {
    const first = advanceLive(LIVE_START, all, [seg(0, 4, "I was born in Tuckahoe, near Hillsborough."), seg(4.5, 6, "I have no")]);
    // The overlap picks up "Hillsborough" again; the transcript then misses four words in a row.
    const s = advanceLive(first, all, [seg(0, 0.5, "Hillsborough."), seg(0.6, 6, "I have no accurate knowledge of my age, never having seen any record."), seg(6.5, 7, "By far")]);
    expect(marks(s.words)).toEqual([["authentic", "skipped", undefined]]);
    const gap = advanceLive(first, all, [seg(0.6, 6, "I have no accurate knowledge of my age, never record containing it."), seg(6.5, 7, "By far")]);
    expect(marks(gap.words).map((m) => m[1])).toEqual(["unsure", "unsure", "unsure", "unsure"]);
  });

  it("finds its place again after a stretch goes missing, without marking the gap", () => {
    const first = advanceLive(LIVE_START, all, [seg(0, 4, "I was born in Tuckahoe, near Hillsborough."), seg(4.5, 6, "I have no")]);
    // The next transcript has lost a whole sentence and starts at "By far".
    const s = advanceLive(first, all, [seg(0, 5, "By far the larger part of the slaves know as music of their ages"), seg(5.5, 6, "as horses")]);
    expect(s.words).toHaveLength(37);
    expect(marks(s.words.slice(0, 23)).every((m) => m[1] === "unsure")).toBe(true);
    expect(marks(s.words.slice(23))).toEqual([["little", "substituted", "music"]]);
    expect(s.audioFrom).toBeGreaterThan(first.audioFrom);
  });

  it("ignores noise and never moves the cursor back", () => {
    const start = advanceLive(LIVE_START, all, [seg(0, 3, "I was born in Tuckahoe near")]);
    expect(advanceLive(start, all, [seg(0, 1, "Thank you."), seg(1, 2, "Thanks for watching.")])).toEqual(start);
    expect(advanceLive(start, all, [])).toBe(start);
    expect(advanceLive(start, all, [seg(0, 1, "I was")]).cursor).toBe(4);
  });
});
