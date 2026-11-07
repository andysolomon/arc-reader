// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToText } from "./fetchUrl";

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
