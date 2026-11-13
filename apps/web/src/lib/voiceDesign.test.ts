import { describe, expect, it } from "vitest";
import type { Design, DesignMatch } from "./studio";
import { explainDesign, leftoverPieces } from "./voiceDesign";

const AUTO = { Gender: "Auto", Age: "Auto", Pitch: "Auto", Style: "Auto", EnglishAccent: "Auto", ChineseDialect: "Auto" };
const design = (attrs: Partial<typeof AUTO>, matched: DesignMatch[], unmatched: string[] = []): Design =>
  ({ attrs: { ...AUTO, ...attrs }, instruct: Object.values(attrs).join(", "), matched, unmatched });

// A tiny stand-in for VoiceStudio's matcher: first synonym per setting wins, like describe_voice.py.
const SYNONYMS: [string, string, string[]][] = [
  ["Pitch", "very low pitch", ["booming", "very deep"]],
  ["Pitch", "low pitch", ["deep", "low-pitched"]],
  ["EnglishAccent", "american accent", ["american"]],
  ["Gender", "male", ["man"]],
];
async function fakeDescribe(text: string): Promise<Design> {
  const matched: DesignMatch[] = [];
  for (const [category, token, phrases] of SYNONYMS) {
    if (matched.some((m) => m.category === category)) continue;
    const phrase = phrases.find((p) => new RegExp(`\\b${p}\\b`).test(text));
    if (phrase) matched.push({ category, token, phrase });
  }
  return design(Object.fromEntries(matched.map((m) => [m.category, m.token])), matched);
}

const GAME_SHOW = "A smooth, overconfident 1970s American game-show host. Deep, booming, and theatrical, stretching out vowels and landing every sentence like a big reveal.";

describe("leftoverPieces", () => {
  it("keeps the unmatched words of a clause that also had a match", () => {
    expect(leftoverPieces(GAME_SHOW, [{ category: "Pitch", token: "very low pitch", phrase: "booming" }, { category: "EnglishAccent", token: "american accent", phrase: "american" }]))
      .toEqual(["smooth", "overconfident 1970s", "game-show host", "deep", "theatrical", "stretching out vowels and landing every sentence like a big reveal"]);
  });

  it("drops glue words left beside a match", () => {
    expect(leftoverPieces("A deep voice with an American accent", [{ category: "Pitch", token: "low pitch", phrase: "deep" }, { category: "EnglishAccent", token: "american accent", phrase: "american" }])).toEqual([]);
  });

  it("doesn't cut a phrase out of a longer word", () => {
    expect(leftoverPieces("a manly woman", [{ category: "Gender", token: "male", phrase: "man" }])).toEqual(["manly woman"]);
  });
});

describe("explainDesign", () => {
  it("credits redundant synonyms and reports only what no setting can express", async () => {
    const result = await fakeDescribe(GAME_SHOW.toLowerCase());
    expect(await explainDesign(GAME_SHOW, result, fakeDescribe)).toEqual({
      heard: { Pitch: ["booming", "deep"], EnglishAccent: ["american"] },
      ignored: ["smooth", "overconfident 1970s", "game-show host", "theatrical", "stretching out vowels and landing every sentence like a big reveal"],
    });
  });

  it("peels several synonyms out of one clause", async () => {
    const text = "very deep low-pitched raspy man";
    expect(await explainDesign(text, await fakeDescribe(text), fakeDescribe)).toEqual({ heard: { Pitch: ["very deep", "low-pitched"], Gender: ["man"] }, ignored: ["raspy"] });
  });

  it("treats a failed lookup as ignored rather than failing the interpretation", async () => {
    const text = "deep and raspy";
    const result = await fakeDescribe(text);
    expect(await explainDesign(text, result, () => Promise.reject(new Error("offline")))).toEqual({ heard: { Pitch: ["deep"] }, ignored: ["raspy"] });
  });

  it("falls back to VoiceStudio's clause list when the server doesn't report matches", async () => {
    expect(await explainDesign("raspy", { attrs: AUTO, instruct: "", unmatched: ["raspy"] }, fakeDescribe)).toEqual({ heard: {}, ignored: ["raspy"] });
  });
});
