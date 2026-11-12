import { describe, expect, it } from "vitest";
import { absoluteUrl, linksInMarkdown, linksInText, uniqueLinks } from "./links";

describe("links", () => {
  it("resolves relative links and drops non-web and in-page ones", () => {
    const base = "https://example.com/blog/post";
    expect(absoluteUrl("/about", base)).toBe("https://example.com/about");
    expect(absoluteUrl("next", base)).toBe("https://example.com/blog/next");
    expect(absoluteUrl("#section", base)).toBeNull();
    expect(absoluteUrl("https://other.org/page#part", base)).toBe("https://other.org/page#part");
    expect(absoluteUrl("mailto:me@example.com", base)).toBeNull();
    expect(absoluteUrl("javascript:void(0)", base)).toBeNull();
    expect(absoluteUrl("not a url")).toBeNull();
  });

  it("finds bare URLs without trailing punctuation", () => {
    expect(linksInText("See https://a.com/x. Also (https://b.org/wiki/Foo_(bar)) and https://c.net, then stop.")).toEqual([
      { url: "https://a.com/x", text: "https://a.com/x" },
      { url: "https://b.org/wiki/Foo_(bar)", text: "https://b.org/wiki/Foo_(bar)" },
      { url: "https://c.net/", text: "https://c.net/" },
    ]);
  });

  it("ignores a scheme with no address after it", () => {
    expect(linksInText("even if a link says http://”. This defeats downgrade attacks, and https://… is not one either.")).toEqual([]);
    expect(linksInText("Use “https://a.com/x” or ‘https://b.org’.").map((l) => l.url)).toEqual(["https://a.com/x", "https://b.org/"]);
  });

  it("reads Markdown links with their text and skips images", () => {
    expect(linksInMarkdown('Read [the docs](https://a.com/docs "Docs") and ![logo](https://a.com/logo.png), or [rel](/x) at https://b.com', "https://a.com/")).toEqual([
      { url: "https://a.com/docs", text: "the docs" },
      { url: "https://a.com/x", text: "rel" },
      { url: "https://b.com/", text: "https://b.com/" },
    ]);
  });

  it("keeps the first of each URL and prefers real link text", () => {
    expect(uniqueLinks([
      { url: "https://a.com/", text: "https://a.com/" },
      { url: "https://a.com/", text: "  Alpha\n site " },
      { url: "https://a.com/", text: "Later" },
      { url: "https://b.com/", text: "" },
    ])).toEqual([{ url: "https://a.com/", text: "Alpha site" }, { url: "https://b.com/", text: "https://b.com/" }]);
  });
});
