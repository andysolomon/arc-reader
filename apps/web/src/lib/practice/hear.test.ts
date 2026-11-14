import { describe, expect, it } from "vitest";
import { alignTranscript } from "./align";
import { hearReading, hearWord, looksDropped } from "./hear";
import { tokens } from "./words";

const marks = (passage: string, ...transcripts: string[]) =>
  hearReading(tokens(passage), transcripts).words.filter((w) => w.verdict !== "correct").map((w) => [w.word, w.verdict, w.heard]);

describe("hearReading", () => {
  it("names skipped, substituted and mispronounced words", () => {
    expect(marks("I have no accurate knowledge of my age, never having seen any authentic record.", "I have no accurate music of my age never having any otnetic record")).toEqual([
      ["knowledge", "substituted", "music"],
      ["seen", "skipped", undefined],
      ["authentic", "mispronounced", "otnetic"],
    ]);
  });

  it("gives the benefit of the doubt on names, small words and endings", () => {
    expect(marks("Go from Corlears Hook to Coenties Slip.", "Go from Corlear's Hook to Coiny's Slip")).toEqual([["Coenties", "unsure", "coiny's"]]);
    expect(marks("Go from Corlears Hook to Coenties Slip.", "Go from Corlear's Hook to Quinty Slip")).toEqual([["Coenties", "unsure", "quinty"]]);
    expect(marks("Go from Corlears Hook to Coenties Slip.", "Go from Corlear's Hook to Slip")).toEqual([["Coenties", "skipped", undefined]]);
    expect(marks("The eagle is in the mountains.", "The eagle is and the mountains")).toEqual([["in", "unsure", "and"]]);
    expect(marks("By gravelled driveways under wide-spreading lawns.", "By gravel driveways under widespread lawns")).toEqual([
      ["gravelled", "unsure", "gravel"], ["wide-spreading", "unsure", "widespread"],
    ]);
    // A name that opens a sentence can't be told from an ordinary word, and a real word swap still counts.
    expect(marks("He went from the house.", "He went form the house")).toEqual([["from", "mispronounced", "form"]]);
  });

  it("takes a word as read when any transcript heard it", () => {
    const passage = "Circumambulate the city of a dreamy Sabbath afternoon. What do you see? Posted like silent sentinels.";
    const fast = "What do you see? Posted like silent table.";
    const slow = "circumambulate the city of a dreamy sabbath afternoon what do you see posted like silent table";
    expect(looksDropped(alignTranscript(tokens(passage), fast))).toBe(true);
    expect(looksDropped(alignTranscript(tokens(passage), slow))).toBe(false);
    expect(marks(passage, fast, slow)).toEqual([["sentinels", "substituted", "table"]]);
    expect(hearReading(tokens(passage), [fast, slow]).matched).toBeCloseTo(15 / 16);
  });

  it("reports an off-script take as mostly unread", () => {
    expect(hearReading(tokens("I was born in Tuckahoe, near Hillsborough."), ["Thank you for watching."]).matched).toBe(0);
  });
});

describe("hearWord", () => {
  it("is right when the word is in the transcript, unsure on silence", () => {
    expect(hearWord("authentic", "Authentic.")).toBe("correct");
    expect(hearWord("authentic", "um, authentic")).toBe("correct");
    expect(hearWord("their", "There.")).toBe("correct");
    expect(hearWord("sun-kissed", "sunkissed")).toBe("correct");
    expect(hearWord("authentic", "Otnetic.")).toBe("wrong");
    expect(hearWord("authentic", "")).toBe("unsure");
  });
});
