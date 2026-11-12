// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { htmlToText, isWebAddress, looksLikeUrl, markdownToText, publishedDate } from "./fetchUrl";
import { segment } from "./segment";
import { placeLinks } from "./linkPlaces";

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

const page = (head: string) => `<html><head><title>Doc title</title>${head}</head><body><article><p>Body paragraph one.</p><p>Body paragraph two is here.</p></article></body></html>`;

describe("page metadata", () => {
  it("keeps the link and reads author, date, site and description from meta tags", () => {
    const { meta, text } = htmlToText(page(`
      <meta name="author" content=" Ada  Lovelace ">
      <meta property="article:published_time" content="2026-10-01T09:30:00Z">
      <meta property="og:site_name" content="Example Weekly">
      <meta name="description" content="What the article is about.">`), "https://example.com/a");
    expect(meta).toEqual({ url: "https://example.com/a", author: "Ada Lovelace", published: "2026-10-01", site: "Example Weekly", description: "What the article is about." });
    expect(text).toContain("Body paragraph one.");
  });

  it("falls back to JSON-LD authors and dates, ignoring author profile links", () => {
    const { meta } = htmlToText(page(`
      <meta property="article:author" content="https://example.com/people/ada">
      <script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Article","datePublished":"2025-03-04","author":[{"name":"Ada"},{"name":"Grace"}]}]}</script>`), "https://example.com/b");
    expect(meta).toEqual({ url: "https://example.com/b", author: "Ada, Grace", published: "2025-03-04" });
  });

  it("normalizes parseable dates and keeps others as written", () => {
    expect(publishedDate("March 4, 2025 12:00 UTC")).toBe("2025-03-04");
    expect(publishedDate("Spring 2025")).toBe("Spring 2025");
    expect(publishedDate("  ")).toBeUndefined();
  });
});

describe("htmlToText", () => {
  it("keeps the article's links, resolved against the page, and leaves out navigation", () => {
    const html = `<html><head><title>Post</title></head><body>
      <nav><a href="/home">Home</a></nav>
      <article><p>Read <a href="/guide">the guide</a>, <a href="https://other.org/x">another site</a> and <a href="#top">top</a>.</p>
      <p><a href="mailto:a@b.c">mail</a> <a href="https://other.org/x">again</a></p></article>
    </body></html>`;
    expect(htmlToText(html, "https://example.com/blog/post").links).toEqual([
      { url: "https://example.com/guide", text: "the guide" },
      { url: "https://other.org/x", text: "another site" },
    ]);
  });
});

describe("keeping an article's structure", () => {
  it("marks headings so the reading keeps its outline", () => {
    const { text } = htmlToText(`<article><h2>Why databases exist</h2><p>They persist data.</p><h3>Disk <code>vs</code> RAM</h3><p>Disk is roomy.</p></article>`, "https://example.com/a");
    expect(text).toBe("## Why databases exist\n\nThey persist data.\n\n### Disk vs RAM\n\nDisk is roomy.");
    const { paragraphs, sentences } = segment(text);
    expect(paragraphs.map((p) => p.heading)).toEqual([2, undefined, 3, undefined]);
    // The marker is for the page, not the voice.
    expect(sentences.map((s) => s.text)).toEqual(["Why databases exist", "They persist data.", "Disk vs RAM", "Disk is roomy."]);
  });

  it("keeps headings from the Markdown proxy and from pasted Markdown", () => {
    expect(markdownToText("# Title\n\nSome **bold** text.")).toBe("# Title\n\nSome bold text.");
    const { paragraphs, sentences } = segment("Intro line.\n## Setup ##\nInstall it first.\n#hashtag is not a heading.");
    expect(paragraphs.map((p) => p.heading)).toEqual([undefined, 2, undefined]);
    expect(sentences.map((s) => s.text)).toEqual(["Intro line.", "Setup", "Install it first.", "#hashtag is not a heading."]);
  });

  it("keeps callouts set beside the text and drops sidebars", () => {
    const html = `<main><article><p>Before the note.</p>
      <aside class="callout is-info"><p class="callout-title">Mental model</p><p>A database is a persistence layer.</p></aside>
      <aside role="note"><p>Verified on PostgreSQL 16.</p></aside>
      <aside class="starlight-aside starlight-aside--tip"><p>Use bigserial.</p></aside>
      <aside class="related"><p>Related posts you might like.</p></aside>
      <aside class="callout"><form><input></form>Subscribe to the newsletter.</aside>
      <p>After the note.</p></article><aside class="author-info">About the author.</aside></main>`;
    expect(htmlToText(html, "https://example.com/a").text.split("\n\n")).toEqual([
      "Before the note.", "Mental model", "A database is a persistence layer.", "Verified on PostgreSQL 16.", "Use bigserial.", "After the note.",
    ]);
  });

  it("reads a table row by row under its column headings", () => {
    const two = `<table><thead><tr><th>Responsibility</th><th>What it means</th></tr></thead><tbody>
      <tr><td><strong>Access</strong></td><td>Provide methods for CRUD.</td></tr><tr><td>Security</td><td>Protect data from <code>unauthorized</code> access</td></tr></tbody></table>`;
    const three = `<table><tr><th>Type</th><th>Size</th><th>Use for</th></tr><tr><td>integer</td><td>4 bytes</td><td>Counts.</td></tr><tr><td>bigint</td><td></td><td>Large IDs</td></tr></table>`;
    const bare = `<table><tr><td>GET</td><td>Read a resource</td></tr><tr><td></td><td></td></tr></table>`;
    const { text } = htmlToText(`<article><p>Intro.</p>${two}${three}${bare}<p>Outro.</p></article>`, "https://example.com/a");
    expect(text.split("\n\n")).toEqual([
      "Intro.",
      "Access: Provide methods for CRUD.",
      "Security: Protect data from unauthorized access.",
      "integer. Size: 4 bytes. Use for: Counts.",
      "bigint. Use for: Large IDs.",
      "GET. Read a resource.",
      "Outro.",
    ]);
  });
});

describe("a fetched page's links in the reading", () => {
  it("places each link at the words it was attached to", () => {
    const html = `<html><body><article>
      <p>Start here. Then read <a href="/guide">the guide</a> before the rest.</p>
      <p>The code is on <a href="https://git.example/repo">our repository</a>.</p></article></body></html>`;
    const page = htmlToText(html, "https://example.com/post");
    expect(placeLinks(page.links, segment(page.text).sentences).map((l) => [l.text, l.at])).toEqual([
      ["the guide", { sentence: 1, word: 3 }],
      ["our repository", { sentence: 2, word: 5 }],
    ]);
  });
});

describe("telling a pasted link from pasted text", () => {
  it("accepts addresses with or without a scheme", () => {
    expect(looksLikeUrl("https://example.com/story?id=1#top")).toBe(true);
    expect(looksLikeUrl("  example.com/story ")).toBe(true);
    expect(looksLikeUrl("x.com/someone/status/123")).toBe(true);
    expect(looksLikeUrl("localhost:5181/read")).toBe(true);
  });
  it("rejects prose, blank input, and bare words", () => {
    expect(looksLikeUrl("")).toBe(false);
    expect(looksLikeUrl("Read https://example.com later")).toBe(false);
    expect(looksLikeUrl("A sentence. Another one.")).toBe(false);
    expect(looksLikeUrl("hello")).toBe(false);
    expect(looksLikeUrl("one\ntwo")).toBe(false);
  });
  it("knows a full address on its own from text that mentions one", () => {
    expect(isWebAddress(" https://backend-from-first-principle.vercel.app/ ")).toBe(true);
    expect(isWebAddress("HTTP://example.com/story")).toBe(true);
    expect(isWebAddress("www.example.com")).toBe(true);
    expect(isWebAddress("example.com")).toBe(false);
    expect(isWebAddress("https://")).toBe(false);
    expect(isWebAddress("Read https://example.com later")).toBe(false);
    expect(isWebAddress("https://example.com\nand some notes")).toBe(false);
  });
});
