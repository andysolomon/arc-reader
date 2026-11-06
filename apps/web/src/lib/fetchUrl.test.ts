// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { htmlToText, markdownToText } from "./fetchUrl";
import { segment } from "./segment";

describe("importing code examples", () => {
  it("preserves preformatted code, language, and nesting without duplicates", () => {
    const html = `<title>Example</title><article><h1>An example</h1><blockquote><p>Before.</p><pre><code class="language-js"><span>const x = 1;</span>\n\nconsole.log(x);</code></pre><p>After.</p></blockquote></article>`;
    const result = htmlToText(html, "https://example.com");
    const parsed = segment(result.text);
    expect(result.title).toBe("Example");
    expect(parsed.paragraphs.filter((p) => p.code)).toHaveLength(1);
    expect(parsed.paragraphs.find((p) => p.code)?.code).toMatchObject({ language: "js", text: "const x = 1;\n\nconsole.log(x);" });
    expect(parsed.sentences.map((s) => s.text)).toContain("Before.");
    expect(parsed.sentences.map((s) => s.text)).toContain("After.");
    expect(parsed.sentences.map((s) => s.text).join(" ")).not.toContain("console");
  });

  it("preserves proxy markdown fences and code syntax while cleaning prose", () => {
    const result = markdownToText('Title: Example\nMarkdown Content:\n# Hello\n[Link](https://example.com)\n\n```js\nconst snake_case = `value`;\n```\n\n**Done.**');
    expect(result).toContain('const snake_case = `value`;');
    expect(result).not.toContain("Title:");
    expect(segment(result).paragraphs.find((p) => p.code)?.code?.language).toBe("js");
    expect(segment(result).sentences.at(-1)?.text).toBe("Done.");
  });
});

describe("article images and diagrams", () => {
  it("keeps figure captions, lazy sources, relative URLs and prose in reading order", () => {
    const result = htmlToText(`<title>Pictures</title><article><p>Before.</p>
      <figure><figcaption>A chart of revenue rising.</figcaption><picture><source srcset="/small.png 400w, /large.png 1200w"><img src="placeholder.gif" data-src="../revenue.png" alt="Revenue chart"></picture></figure>
      <p>Between.</p><img src="/photo.jpg" alt="A team at work"><p>After.</p>
      <img src="/decorative.png" alt=""><img src="/pixel.gif" width="1" height="1">
      </article>`, "https://example.com/news/story");
    const parsed = segment(result.text);
    expect(parsed.paragraphs.map((p) => p.visual?.kind || "prose")).toEqual(["prose", "diagram", "prose", "image", "prose"]);
    expect(parsed.paragraphs[1].visual).toMatchObject({ src: "https://example.com/revenue.png", caption: "A chart of revenue rising." });
    expect(parsed.sentences.map((s) => s.text).join(" ").match(/revenue rising/g)).toHaveLength(1);
    expect(parsed.paragraphs[3].visual?.src).toBe("https://example.com/photo.jpg");
  });
  it("chooses a responsive source and preserves accessible inline SVG as an inert image", () => {
    const result = htmlToText(`<article><p>An illustrated process.</p><img srcset="small.png 300w, big.png 1200w" alt="Photo">
      <figure><svg viewBox="0 0 600 300" role="img" onload="alert(1)"><title>Processing steps</title><desc>Input flows to output.</desc><script>alert(1)</script><foreignObject>Unsafe</foreignObject><rect width="100" height="100"/><text>Input</text></svg></figure><p>End.</p></article>`, "https://example.com/article");
    const visuals = segment(result.text).paragraphs.flatMap((p) => p.visual ? [p.visual] : []);
    expect(visuals[0].src).toBe("https://example.com/big.png");
    expect(visuals[1]).toMatchObject({ kind: "diagram", alt: "Processing steps", caption: "Input flows to output." });
    expect(visuals[1].src).toMatch(/^data:image\/svg\+xml/);
    const svg = decodeURIComponent(visuals[1].src);
    expect(svg).toContain("<rect");
    expect(svg).not.toMatch(/onload|script|foreignObject/);
    expect(segment(result.text).sentences.map((s) => s.text).join(" ")).not.toMatch(/<svg|data:image|alert/);
  });
  it("retains Markdown proxy images and resolves their relative locations", () => {
    const text = markdownToText('Title: Example\n# Hello\n\n![A diagram](../flow.png "Steps in order")\n\nDone.', "https://example.com/news/story");
    expect(segment(text).paragraphs.find((p) => p.visual)?.visual).toMatchObject({ src: "https://example.com/flow.png", alt: "A diagram", caption: "Steps in order" });
  });
});
