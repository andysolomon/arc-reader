// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToText, publishedDate } from "./fetchUrl";

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
