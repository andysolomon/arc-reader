import { describe, expect, it } from "vitest";
import { readingGrade, syllables } from "./readability";
import { acceptableRewrite } from "./rewrite";

describe("readingGrade", () => {
  it("estimates syllables", () => {
    expect(["cat", "table", "reading", "beautiful", "the", "created"].map(syllables)).toEqual([1, 2, 2, 3, 1, 2]);
  });

  it("rates plain prose lower than dense prose", () => {
    const plain = "The dog ran to the park. It saw a red ball. The boy threw it far. The dog ran fast and got it.";
    const dense = "The constitutional deliberations concerning representative institutions necessitated extraordinarily sophisticated philosophical justification, particularly regarding the proportional distribution of legislative authority.";
    expect(readingGrade(plain)).toBeLessThan(3);
    expect(readingGrade(dense)).toBeGreaterThan(16);
  });
});

describe("acceptableRewrite", () => {
  const words = (n: number, w = "The dog ran to the park.") => Array.from({ length: Math.ceil(n / 6) }, () => w).join(" ").split(" ").slice(0, n).join(" ").replace(/\.?$/, ".");
  it("wants the band's length, plain prose, an end stop and an easy grade", () => {
    expect(acceptableRewrite(words(60), "6-8")).toBe(true);
    expect(acceptableRewrite(words(40), "6-8")).toBe(false);
    expect(acceptableRewrite(words(90), "6-8")).toBe(false);
    expect(acceptableRewrite(`**Title** ${words(60)}`, "6-8")).toBe(false);
    expect(acceptableRewrite(words(60).replace(/\.$/, ""), "6-8")).toBe(false);
    const hard = Array.from({ length: 8 }, () => "Unprecedented constitutional deliberations necessitated sophisticated justification.").join(" ");
    expect(acceptableRewrite(hard, "6-8")).toBe(false);
  });
});
