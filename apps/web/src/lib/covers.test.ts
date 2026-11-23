import { describe, expect, it } from "vitest";
import { ARTICLE_COVER, coverPlaces, coverPlan } from "./covers";
import { segment } from "./segment";

const article = `# How Sourdough Works

A starter is flour and water left to ferment.

## The starter

Wild yeast and bacteria live in it.

### Feeding

Fresh flour keeps them alive.

### Feeding

A second note on feeding, under the same words.

## Baking

Steam lets the loaf rise before the crust sets.

\`\`\`
## not a heading, this is code
\`\`\`

## Notes
`;

describe("what a document's covers are of", () => {
  const { sections, headings } = coverPlan({ title: "How Sourdough Works", text: article });

  it("has one cover for the article and one for every section, nested ones included, in reading order", () => {
    expect(sections.map((s) => [s.kind, s.heading, s.level])).toEqual([
      ["article", "How Sourdough Works", 0],
      ["section", "The starter", 2],
      ["section", "Feeding", 3],
      ["section", "Feeding", 3],
      ["section", "Baking", 2],
      ["section", "Notes", 2],
    ]);
  });

  it("does not count the heading that repeats the title, or a heading inside code", () => {
    expect(sections.filter((s) => s.heading === "How Sourdough Works")).toHaveLength(1);
    expect(sections.some((s) => s.heading.includes("not a heading"))).toBe(false);
    expect(headings).toBe(6);
  });

  it("keeps two sections with the same heading apart, and names each by the headings above it", () => {
    const [first, second] = sections.filter((s) => s.heading === "Feeding");
    expect(first.key).not.toBe(second.key);
    expect(first.path).toEqual(["The starter", "Feeding"]);
    expect(first.parent).toBe(sections[1].key);
    expect(sections[1].parent).toBe(ARTICLE_COVER);
  });

  it("draws the article from all of it, and a section from its own text and the sections inside it", () => {
    expect(sections[0].body).toContain("A starter is flour");
    expect(sections[0].body).toContain("Steam lets the loaf rise");
    expect(sections[1].body).toContain("Wild yeast");
    expect(sections[1].body).toContain("Fresh flour keeps them alive");
    expect(sections[1].body).not.toContain("Steam");
    expect(sections[2].body).toBe("Fresh flour keeps them alive.");
    expect(sections[0].body).not.toContain("this is code");
  });

  it("leaves a heading with nothing under it without text to draw from", () => {
    expect(sections.at(-1)).toMatchObject({ heading: "Notes", body: "" });
  });

  it("keeps a section's key when text elsewhere changes", () => {
    const edited = coverPlan({ title: "How Sourdough Works", text: article.replace("Steam lets", "Hot steam lets") });
    expect(edited.sections.map((s) => s.key)).toEqual(sections.map((s) => s.key));
    expect(edited.sections[1].body).toBe(sections[1].body);
    expect(edited.sections[4].body).not.toBe(sections[4].body);
  });

  it("has only the article's cover when there are no headings", () => {
    expect(coverPlan({ title: "A note", text: "Just one paragraph." }).sections.map((s) => s.kind)).toEqual(["article"]);
  });

  it("places each section's cover before its heading as the Reader lists them", () => {
    const { paragraphs } = segment(article);
    const places = coverPlaces(paragraphs, sections, headings);
    const placed = [...places].map(([index, key]) => [paragraphs[index].sentences[0].text, sections.find((s) => s.key === key)!.heading]);
    expect(placed).toEqual([["The starter", "The starter"], ["Feeding", "Feeding"], ["Feeding", "Feeding"], ["Baking", "Baking"], ["Notes", "Notes"]]);
  });

  it("places nothing when the text shown has other headings than the covers were made from", () => {
    expect(coverPlaces(segment("## Only one\n\nText.").paragraphs, sections, headings).size).toBe(0);
  });
});
