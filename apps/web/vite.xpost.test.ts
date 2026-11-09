// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { xPostHtml, xPostId, type FxTweet } from "./vite.xpost";
import { htmlToText } from "./src/lib/fetchUrl";

const POST = "https://x.com/_vmlops/status/2119812449440563432";

describe("X posts", () => {
  it("finds the status id in post links only", () => {
    expect(xPostId(new URL(`${POST}?s=46`))).toBe("2119812449440563432");
    expect(xPostId(new URL("https://twitter.com/jack/status/20"))).toBe("20");
    expect(xPostId(new URL("https://mobile.twitter.com/i/web/status/20"))).toBe("20");
    expect(xPostId(new URL("https://x.com/i/status/20/photo/1"))).toBe("20");
    expect(xPostId(new URL("https://x.com/jack"))).toBeNull();
    expect(xPostId(new URL("https://notx.com/jack/status/20"))).toBeNull();
  });

  it("reads an X Article with headings, lists, captioned images and links", () => {
    const tweet: FxTweet = {
      url: POST,
      text: "https://x.com/i/article/2119808417095462912",
      created_timestamp: 1794237646,
      author: { name: "Vaishnavi", screen_name: "_vmlops" },
      article: {
        title: "Agent Harness: The Code That Can Make or Break Your Agent",
        preview_text: "Here's a number that should change how you build agents.",
        cover_media: { media_id: "1", media_info: { original_img_url: "https://pbs.twimg.com/media/cover.jpg" } },
        media_entities: [{ media_id: "2", media_info: { original_img_url: "https://pbs.twimg.com/media/chart.jpg" } }],
        content: {
          blocks: [
            { type: "unstyled", text: "Here's a number that should change how you build agents. Same model. Same 89 tasks." },
            { type: "header-two", text: "First, What Is a Harness?" },
            { type: "unordered-list-item", text: "System prompt: the role and the rules." },
            { type: "unordered-list-item", text: "Tools: shell access & file edits." },
            { type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
            { type: "unstyled", text: "Read the Meta-Harness paper.", entityRanges: [{ key: 1, offset: 9, length: 12 }] },
          ],
          entityMap: [
            { key: "0", value: { type: "MEDIA", data: { caption: "What this shows: the model is the smallest box.", mediaItems: [{ mediaId: "2" }] } } },
            { key: "1", value: { type: "LINK", data: { url: "https://arxiv.org/abs/meta-harness" } } },
          ],
        },
      },
    };
    const page = htmlToText(xPostHtml(tweet), POST);
    expect(page.title).toBe('Vaishnavi on X: "Agent Harness: The Code That Can Make or Break Your Agent"');
    expect(page.meta).toMatchObject({ author: "Vaishnavi", published: "2026-11-09", site: "X" });
    expect(page.text).toContain("First, What Is a Harness?");
    expect(page.text).toContain("Tools: shell access & file edits.");
    expect(page.text).toContain("chart.jpg");
    expect(page.text).toContain("What this shows: the model is the smallest box.");
    expect(page.text).not.toContain("x.com/i/article");
    expect(page.links).toEqual([{ url: "https://arxiv.org/abs/meta-harness", text: "Meta-Harness" }]);
  });

  it("reads an ordinary post with its photos and quoted post", () => {
    const html = xPostHtml({
      text: "First line <b>not markup</b>\n\nSecond paragraph",
      author: { screen_name: "jack" },
      media: { photos: [{ url: "https://pbs.twimg.com/media/photo.jpg", altText: "A cat" }] },
      quote: { text: "The quoted words", author: { name: "Biz" } },
    });
    const page = htmlToText(html, "https://x.com/jack/status/20");
    expect(page.title).toBe('@jack on X: "First line <b>not markup</b>"');
    expect(page.text).toContain("First line <b>not markup</b>");
    expect(page.text).toContain("Second paragraph");
    expect(page.text).toContain("A cat");
    expect(page.text).toContain("The quoted words");
  });
});
