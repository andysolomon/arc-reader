import { describe, expect, it } from "vitest";
import { alignTranscript, normal, numberWords, similarity } from "./align";
import { tokens } from "./words";

const PASSAGE = "I was born in Tuckahoe, near Hillsborough, and about twelve miles from Easton, in Talbot county, Maryland. I have no accurate knowledge of my age, never having seen any authentic record containing it.";
const align = (transcript: string, passage = PASSAGE) => {
  const words = tokens(passage);
  const a = alignTranscript(words, transcript);
  return { ...a, marked: a.words.flatMap((w, i) => (w.kind === "correct" ? [] : [[words[i].word, w.kind, "heard" in w ? w.heard : undefined, "close" in w ? w.close : undefined]])) };
};

describe("normal", () => {
  it("writes digits, titles and spellings one way", () => {
    expect(numberWords(12)).toEqual(["twelve"]);
    expect(normal("1,865")).toEqual(normal("one thousand eight hundred sixty five"));
    expect(normal("1,865")).toHaveLength(6);
    expect(normal("“Colour,”")).toEqual(["color"]);
    expect(normal("Mr.")).toEqual(["mister"]);
    expect(normal("frost-kissed")).toEqual(["frost", "kissed"]);
    expect(normal("Miller’s")).toEqual(["millers"]);
    expect(normal("travelled")).toEqual(normal("traveled"));
    expect(normal("filled")).not.toEqual(normal("filed"));
    expect(normal("—")).toEqual([]);
    expect(similarity("authentic", "otnetic")).toBeGreaterThan(0.5);
  });
});

describe("alignTranscript", () => {
  it("passes a faithful transcript, whatever its punctuation, digits and capitals", () => {
    const a = align("I was born in Tuckahoe near Hillsborough and about 12 miles from Easton, in Talbot County, Maryland. I have no accurate knowledge of my age, never having seen any authentic record containing it.");
    expect(a.marked).toEqual([]);
    expect(a.matched).toBe(1);
  });

  it("finds swapped, skipped and mispronounced words where they are", () => {
    const a = align("I was quickly in Tuckahoe, near Hillsborough, and about 12 miles from Easton, in Talbot County, Maryland. I have no accurate music of my age, never having any otnetic record containing it.");
    expect(a.marked).toEqual([
      ["born", "misread", "quickly", false],
      ["knowledge", "misread", "music", false],
      ["seen", "skipped", undefined, undefined],
      ["authentic", "misread", "otnetic", true],
    ]);
  });

  it("ignores repeats and false starts, and counts them", () => {
    const a = align("I was I was born in in Tuckahoe near Hillsborough and about twelve miles from um Easton in Talbot county Maryland I have no accurate knowledge of my age never having seen any authentic record containing it");
    expect(a.marked).toEqual([]);
    expect(a.added).toBe(4);
  });

  it("accepts a word heard as two, or two heard as one", () => {
    expect(align("I was born in Tucka Hoe near Hillsborough and about twelve miles from Easton in Talbot county Maryland I have no accurate knowledge of my age never having seen any authentic record containing it").marked).toEqual([]);
    expect(align("Any one can see the sun kissed hill", "Anyone can see the sun-kissed hill.").marked).toEqual([]);
    expect(align("anyone can see", "Any one can see.").marked).toEqual([]);
    expect(align("of weekdays pent up", "Of week days pent up.").marked).toEqual([]);
  });

  it("marks part of a hyphenated word and words joined by a dash", () => {
    expect(align("the sun hill and his orphan do all", "The sun-kissed hill, and his orphan--to do all.").marked).toEqual([
      ["sun-kissed", "misread", "", true],
      ["to", "skipped", undefined, undefined],
    ]);
  });

  it("reports how much of the passage was read", () => {
    expect(align("Thank you for watching.").matched).toBeLessThan(0.1);
    expect(align("").matched).toBe(0);
  });
});

describe("homophones and what was heard", () => {
  it("passes words that sound the same and shows a misread word as written", () => {
    expect(align("Hear they're bows practice", "Here their boughs practise.").marked).toEqual([]);
    expect(align("I have no accurate Music of my age", "I have no accurate knowledge of my age.").marked).toEqual([["knowledge", "misread", "music", false]]);
    expect(align("about 15 miles", "About twelve miles.").marked).toEqual([["twelve", "misread", "15", false]]);
    // Numbers that have sound-alikes ("two", "four", "eight") still match their digits.
    expect(align("she was 2 and he was 4 or 8", "She was two and he was four or eight.").marked).toEqual([]);
  });
});
