import { describe, it, expect } from "vitest";
import { imageSource, visualBlock, visualKey, visualNarration, type ArticleVisual } from "./visuals";
import { readingBlocks } from "./codeBlocks";
import { segment, planPassages } from "./segment";
const visual: ArticleVisual = { kind: "diagram", src: "https://example.com/chart.png", alt: "Flow chart", caption: "A request passes from the client through a server to a database." };

describe("visual narration", () => {
  it("preserves one listening target per visual, with no image URL or metadata in speech", () => {
    const text = `Before.\n\n${visualBlock(visual)}\n\nAfter. Next.`;
    const descriptions = { [visualKey(visual)]: "The client sends a request to the server. The server queries the database." };
    const result = segment(text, {}, descriptions);
    expect(result.sentences.map((s) => s.text)).toEqual(["Before.", descriptions[visualKey(visual)], "After.", "Next."]);
    expect(result.paragraphs.map((p) => p.start)).toEqual([0, 1, 2]);
    expect(result.paragraphs[1].visual).toMatchObject({ ...visual, source: "description" });
    expect(planPassages(result.sentences).map((p) => p.text).join(" ")).not.toMatch(/https:|readaloud-visual|chart\.png/);
  });
  it("uses article descriptions honestly when vision is unavailable and invalidates changed images", () => {
    expect(visualNarration(visual)).toEqual({ source: "caption", text: `Diagram description from the article: ${visual.caption}` });
    const descriptions = { [visualKey(visual)]: "Generated description." };
    expect(visualNarration({ ...visual, src: "https://example.com/new.png" }, descriptions).source).toBe("caption");
    expect(visualNarration({ ...visual, caption: "", alt: "IMG_0101.png" }).source).toBe("unavailable");
    expect(visualNarration({ ...visual, caption: "", alt: "https://example.com/photo.png" }).text).not.toContain("https");
  });
  it("handles Markdown images within prose, including parentheses, and leaves fenced code alone", () => {
    const text = 'Before ![A chart](https://example.com/chart(1).png "Revenue rises") after.';
    expect(readingBlocks(text).map((b) => b.kind)).toEqual(["prose", "visual", "prose"]);
    expect(segment(text).paragraphs[1].visual?.src).toBe("https://example.com/chart(1).png");
    expect(readingBlocks('```md\n' + text + '\n```')[0].kind).toBe("code");
  });
  it("does not let malformed metadata, unsafe URLs, or a caption's fences escape into narration", () => {
    const text = visualBlock({ ...visual, caption: "Caption with ``` fences" });
    expect(readingBlocks(text)).toHaveLength(1);
    expect(readingBlocks('```readaloud-visual\nnot json\n```')[0].kind).toBe("visual");
    expect(segment('```readaloud-visual\nnot json\n```').sentences[0].text).toContain("unavailable");
    for (const url of ["javascript:alert(1)", "file:///private/photo.png", "https://user:secret@example.com/x.png", "data:text/html,hello"]) expect(imageSource(url)).toBe("");
    expect(imageSource("../photo.png", "https://example.com/news/article")).toBe("https://example.com/photo.png");
  });
});
