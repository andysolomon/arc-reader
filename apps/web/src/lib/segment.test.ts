import { describe, it, expect } from "vitest";
import { segment, splitSentences, estimateDuration, titleFrom, planPassages } from "./segment";

describe("segment", () => {
  it("splits on terminal punctuation followed by whitespace", () => {
    expect(splitSentences("One. Two! Three? Four… Five.")).toEqual(["One.", "Two!", "Three?", "Four…", "Five."]);
  });
  it("keeps decimals and abbreviations without trailing space together", () => {
    expect(splitSentences("Version 1.5 shipped. Done.")).toEqual(["Version 1.5 shipped.", "Done."]);
  });
  it("groups paragraphs and tracks flat start indices", () => {
    const s = segment("A b. C d.\n\nE f.");
    expect(s.sentences.map((x) => x.text)).toEqual(["A b.", "C d.", "E f."]);
    expect(s.paragraphs.map((p) => p.start)).toEqual([0, 2]);
  });
  it("estimates duration at 2.83 words/sec plus a pause", () => {
    expect(estimateDuration(["a", "b", "c"])).toBeCloseTo((3 + 1.2) / 2.83);
  });
  it("derives a title from the first sentence", () => {
    expect(titleFrom("Hello world. More.")).toBe("Hello world.");
    expect(titleFrom("x".repeat(100))).toHaveLength(65);
  });
});

describe("planPassages", () => {
  const sent = (para: number, n: number) => ({ para, text: Array.from({ length: n }, (_, i) => `w${i}`).join(" ") + ".", words: Array.from({ length: n }, (_, i) => `w${i}`) });

  it("keeps a paragraph together and never joins two paragraphs", () => {
    const p = planPassages([sent(0, 5), sent(0, 6), sent(1, 4)], 60);
    expect(p.map((x) => [x.start, x.end])).toEqual([[0, 2], [2, 3]]);
    expect(p[0].text).toBe("w0 w1 w2 w3 w4. w0 w1 w2 w3 w4 w5.");
    expect(p[0].parts.map((w) => w.length)).toEqual([5, 6]);
    expect(p.map((x) => x.index)).toEqual([0, 1]);
  });

  it("cuts a long paragraph into roughly equal shares instead of a long run and a stub", () => {
    const p = planPassages([sent(0, 25), sent(0, 25), sent(0, 25), sent(0, 25)], 60);
    expect(p.map((x) => [x.start, x.end])).toEqual([[0, 2], [2, 4]]);
  });

  it("never exceeds the limit when a sentence still fits elsewhere, and leaves an oversized sentence alone", () => {
    const p = planPassages([sent(0, 45), sent(0, 45), sent(0, 10), sent(1, 90)], 60);
    expect(p.map((x) => [x.start, x.end])).toEqual([[0, 1], [1, 3], [3, 4]]);
  });

  it("is a pure function of the text (same plan for the real segmenter)", () => {
    const text = "One two three. Four five.\n\nSix seven eight nine.";
    const a = planPassages(segment(text).sentences);
    const b = planPassages(segment(text).sentences);
    expect(a).toEqual(b);
    expect(a.map((x) => x.text)).toEqual(["One two three. Four five.", "Six seven eight nine."]);
  });
});
