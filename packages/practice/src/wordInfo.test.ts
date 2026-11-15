import { describe, expect, it } from "vitest";
import { parseWordInfo, sentenceAround, syllables } from "./wordInfo";
import { tokens } from "./words";

describe("parseWordInfo", () => {
  it("reads the model's JSON, even wrapped in a code fence", () => {
    const info = parseWordInfo('```json\n{"respelling": "an-uh-MOS-i-tee", "ipa": "/ˌænəˈmɑsəti/", "partOfSpeech": "noun", "meaning": "A strong feeling of dislike.", "root": "Latin animus", "rootMeaning": "spirit", "etymology": null}\n```');
    expect(info).toEqual({
      respelling: "an-uh-MOS-i-tee", ipa: "/ˌænəˈmɑsəti/", partOfSpeech: "noun", meaning: "A strong feeling of dislike.",
      root: "Latin animus", rootMeaning: "spirit", etymology: null,
    });
  });

  it("treats placeholder answers as missing and rejects replies with nothing to show", () => {
    expect(parseWordInfo('{"respelling": "WEN-dee", "meaning": "A girl\'s name.", "root": "unknown", "etymology": "N/A"}')).toMatchObject({ root: null, etymology: null });
    expect(parseWordInfo('{"root": "Latin animus"}')).toBeNull();
    expect(parseWordInfo("Sorry, I can't help with that.")).toBeNull();
    expect(parseWordInfo("{not json}")).toBeNull();
  });
});

describe("syllables", () => {
  it("marks the stressed syllable", () => {
    expect(syllables("an-uh-MOS-i-tee")).toEqual([
      { text: "an", stressed: false }, { text: "uh", stressed: false }, { text: "mos", stressed: true }, { text: "i", stressed: false }, { text: "tee", stressed: false },
    ]);
  });
});

describe("sentenceAround", () => {
  it("finds the sentence a word was read in", () => {
    const words = tokens("All children, except one, grow up. They soon know that they will grow up, and the way Wendy knew was this. One day she was two.");
    const wendy = words.findIndex((w) => w.word === "Wendy");
    expect(sentenceAround(words, wendy)).toBe("They soon know that they will grow up, and the way Wendy knew was this.");
    expect(sentenceAround(words, 0)).toBe("All children, except one, grow up.");
    expect(sentenceAround(words, words.length - 1)).toBe("One day she was two.");
  });
});
