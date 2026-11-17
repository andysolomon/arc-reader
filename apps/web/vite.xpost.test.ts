// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { xPostHtml, xPostId, xPostVideo, type FxTweet } from "./vite.xpost";
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
    expect(page.title).toBe("Agent Harness: The Code That Can Make or Break Your Agent");
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
    expect(page.title).toBe("First line <b>not markup</b>");
    expect(page.meta.author).toBe("@jack");
    expect(page.text).toContain("First line <b>not markup</b>");
    expect(page.text).toContain("Second paragraph");
    expect(page.text).toContain("A cat");
    expect(page.text).toContain("The quoted words");
  });

  it("shows a video by its poster frame, so a post that is only a video still opens", () => {
    const html = xPostHtml({
      author: { name: "Joseph" },
      media: { videos: [
        { url: "https://video.twimg.com/tweet_video/loop.mp4", thumbnail_url: "https://pbs.twimg.com/tweet_video_thumb/loop.jpg", duration: 3, type: "gif" },
        { url: "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/big.mp4", thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg", duration: 2186.617, type: "video" },
      ] },
    });
    const page = htmlToText(html, "https://x.com/joseph/status/20");
    expect(page.title).toBe("Post by Joseph");
    expect(page.text).toContain("poster.jpg");
    expect(page.text).toContain("Video, 36 minutes");
    expect(page.text).not.toContain("loop.jpg");
    expect(page.text.length).toBeGreaterThan(40);
  });

  it("picks the smallest MP4 of a post's video, from X's own video host only", () => {
    const big = "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/big.mp4?tag=29";
    const small = "https://video.twimg.com/amplify_video/1/vid/avc1/480x270/small.mp4?tag=29";
    const formats = [{ url: "https://video.twimg.com/amplify_video/1/pl/list.m3u8", container: "m3u8" }, { url: big, container: "mp4", bitrate: 2_176_000 }, { url: small, container: "mp4", bitrate: 256_000 }];
    expect(xPostVideo({ media: { videos: [{ url: big, duration: 2186.617, type: "video", formats }] } })).toEqual({ url: small, seconds: 2186.617 });
    expect(xPostVideo({ media: { videos: [{ url: big, duration: 12 }] } })).toEqual({ url: big, seconds: 12 });
    expect(xPostVideo({ media: { videos: [{ url: big, duration: 3, type: "gif" }] } })).toBeNull();
    expect(xPostVideo({ media: { videos: [{ url: "https://evil.example/video.mp4", duration: 12 }] } })).toBeNull();
    expect(xPostVideo({ media: { videos: [{ url: "http://video.twimg.com/a.mp4", duration: 12 }] } })).toBeNull();
    expect(xPostVideo({ text: "No media", quote: { media: { videos: [{ url: big, duration: 12 }] } } })).toBeNull();
  });
});
