import { describe, expect, it } from "vitest";
import { followLinks, linksPassed, placeLinks, type LinkFollower, type PlacedLink } from "./linkPlaces";
import { segment } from "./segment";

const sentences = (text: string) => segment(text).sentences;
const TEXT = "Start here with the style guide, then stop. Click here for more. Later, read the Style Guide again (https://c.net/x).\n\nSee here.";
const LINKS = [
  { url: "https://a.com/guide", text: "the style guide" },
  { url: "https://a.com/more", text: "here" },
  { url: "https://a.com/again", text: "Style Guide" },
  { url: "https://a.com/last", text: "here" },
  { url: "https://gone.example/", text: "words that were cut" },
  { url: "https://c.net/x", text: "https://c.net/x" },
];

describe("placeLinks", () => {
  const placed = placeLinks(LINKS, sentences(TEXT));

  it("puts each link at the last word of its text, in reading order", () => {
    expect(placed.map((l) => [l.url, l.at])).toEqual([
      ["https://a.com/guide", { sentence: 0, word: 5 }],
      // "here" also opens the text, but the link comes after the one before it.
      ["https://a.com/more", { sentence: 1, word: 1 }],
      ["https://a.com/again", { sentence: 2, word: 4 }],
      ["https://c.net/x", { sentence: 2, word: 6 }],
      ["https://a.com/last", { sentence: 3, word: 1 }],
      ["https://gone.example/", null],
    ]);
  });

  it("gives repeated link text to successive occurrences and falls back to earlier ones", () => {
    const again = placeLinks([{ url: "https://b.com/2", text: "fox" }, { url: "https://b.com/1", text: "The quick" }, { url: "https://b.com/3", text: "fox" }], sentences("The quick fox met a fox."));
    expect(again.map((l) => [l.url, l.at?.word])).toEqual([["https://b.com/1", 1], ["https://b.com/2", 2], ["https://b.com/3", 5]]);
  });

  it("finds a Markdown link left in pasted text by its address", () => {
    const [link] = placeLinks([{ url: "https://a.com/docs", text: "manual" }], sentences("Read [the docs](https://a.com/docs) first."));
    expect(link.at).toEqual({ sentence: 0, word: 2 });
  });
});

describe("linksPassed", () => {
  const placed = placeLinks(LINKS, sentences(TEXT));
  const at = (index: number, wordIndex: number, ended = false) => linksPassed(placed, { index, wordIndex, ended });

  it("counts a link once its last word is behind the listener", () => {
    expect(at(0, -1)).toBe(0);
    expect(at(0, 5)).toBe(0);
    expect(at(0, 6)).toBe(1);
    expect(at(1, -1)).toBe(1);
    expect(at(2, 5)).toBe(3);
    expect(at(3, 1)).toBe(4);
  });

  it("counts every link, found or not, when the reading has ended", () => {
    expect(at(3, -1, true)).toBe(6);
  });
});

describe("followLinks", () => {
  const placed = placeLinks(LINKS, sentences(TEXT));
  const snap = (index: number, wordIndex: number, extra: Partial<{ seeks: number; offset: number; ended: boolean }> = {}) =>
    ({ docId: "d", seeks: 1, index, wordIndex, offset: wordIndex >= 0 ? 1 : 0, ended: false, ...extra });
  const run = (steps: ReturnType<typeof snap>[], links: PlacedLink[] = placed) => {
    let follower: LinkFollower | null = null;
    return steps.map((step) => {
      const next = followLinks(follower, links, step);
      follower = next.follower;
      return next.heard.map((l) => l.url);
    });
  };

  it("reports a link when playback moves past it, once", () => {
    expect(run([snap(0, -1), snap(0, 4), snap(0, 5), snap(0, 6), snap(0, 5), snap(0, 7), snap(1, -1)]))
      .toEqual([[], [], [], ["https://a.com/guide"], [], [], []]);
  });

  it("reports links at the end of a sentence when the next one starts, and several at once", () => {
    expect(run([snap(1, 0), snap(3, 0)])).toEqual([[], ["https://a.com/more", "https://a.com/again", "https://c.net/x"]]);
  });

  it("stays quiet when the listener jumps past links", () => {
    expect(run([snap(0, -1), snap(2, -1, { seeks: 2 }), snap(2, 5, { seeks: 2 }), snap(0, -1, { seeks: 3 }), snap(0, 6, { seeks: 3 })]))
      .toEqual([[], [], ["https://a.com/again"], [], ["https://a.com/guide"]]);
  });

  it("waits for the first word after resuming mid-sentence", () => {
    expect(run([snap(0, -1, { offset: 2.5 }), snap(0, 6, { offset: 2.6 }), snap(1, 2)])).toEqual([[], [], ["https://a.com/more"]]);
  });

  it("reports found links, not missing ones, when the reading ends", () => {
    expect(run([snap(3, 0), snap(3, -1, { ended: true })])).toEqual([[], ["https://a.com/last"]]);
  });
});
