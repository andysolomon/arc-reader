import { describe, it, expect } from "vitest";
import { segment, splitSentences, estimateDuration, titleFrom } from "./segment";

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
