import { describe, expect, it } from "vitest";
import type { DocRecord } from "./db";
import { isXPost, videoLength, withTranscript } from "./videoTranscript";

describe("video transcripts", () => {
  it("knows a post on X from any other page", () => {
    expect(isXPost("https://x.com/joseph_tsar_/status/2122750358493728998/video/1?s=46")).toBe(true);
    expect(isXPost("https://twitter.com/jack/status/20")).toBe(true);
    expect(isXPost("https://x.com/jack")).toBe(false);
    expect(isXPost("https://example.com/jack/status/20")).toBe(false);
    expect(isXPost("file:///talk.pdf")).toBe(false);
    expect(isXPost(undefined)).toBe(false);
  });

  it("says how long a video runs", () => {
    expect(videoLength(2186.617)).toBe("36 minutes");
    expect(videoLength(0.4)).toBe("1 second");
    expect(videoLength(40)).toBe("40 seconds");
    expect(videoLength(60)).toBe("1 minute");
    expect(videoLength(3600)).toBe("1 hour");
    expect(videoLength(2 * 3600 + 5 * 60)).toBe("2 hours 5 minutes");
  });

  it("puts what is said after the post's own words, under a heading", () => {
    const rec = { id: "a", title: "A talk", text: "Full course on speaking.\n", chars: 25, updatedAt: 1, summary: { source: "s", text: "Old", model: "m", version: 1, createdAt: 1 } } as DocRecord;
    const next = withTranscript(rec, "First paragraph.\n\nSecond paragraph.\n", 2186.617, 50);
    expect(next.text).toBe("Full course on speaking.\n\n## Transcript\n\nFirst paragraph.\n\nSecond paragraph.");
    expect(next).toMatchObject({ chars: next.text.length, transcript: { seconds: 2186.617, at: 50 }, updatedAt: 50, title: "A talk", summary: rec.summary });
    expect(withTranscript({ ...rec, text: "" }, "Only the video.", 9, 50).text).toBe("## Transcript\n\nOnly the video.");
  });
});
