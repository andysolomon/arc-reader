// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_WORDS, MIN_WORDS, nprReadingScript, passages, resetReadingScripts, scriptFromStory, storyIds, storyParagraphs } from "./readingScript";

const SECTION = `<html><body><main><div class="topic-container"><ul>
  <li><a class="topic-title" href="/nx-s1-1">First story</a></li>
  <li><a class="topic-title" href="/nx-s1-2">Second story</a></li>
  <li><a class="topic-title" href="/nx-s1-1">First story again</a></li>
  <li><a href="/1008">Culture</a></li>
</ul></div></main></body></html>`;

const LONG_A = "The city council met on Tuesday night to debate a plan that would add bike lanes to three of the busiest streets downtown.";
const LONG_B = "Supporters said the lanes would make cycling safer, while several shop owners worried about losing parking spaces in front of their stores.";
const LONG_C = "A final vote is expected next month after the transportation department finishes a study of traffic patterns.";

const story = (paragraphs: string) => `<html><head><title>Bike lanes</title></head><body><main><article><div class="story-container">
  <div class="story-head"><h1 class="story-title">Council weighs  new bike lanes</h1></div>
  <div class="paragraphs-container">${paragraphs}</div></div></article></main></body></html>`;

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const count = (text: string) => text.split(/\s+/).length;

describe("storyIds", () => {
  it("lists each linked story once, in order", () => {
    expect(storyIds(SECTION)).toEqual(["nx-s1-1", "nx-s1-2"]);
  });
});

describe("storyParagraphs", () => {
  it("keeps prose and drops lists, italic credits, labels, and unfinished lines", () => {
    const doc = parse(story(`<p>${LONG_A}</p><p>A sentence with <a href="/y">a link</a> inside it is still prose.</p><p><em>Read: </em></p><p><ul><li><a href="/x">More</a></li></ul></p>
      <p><em>This episode was produced by someone and edited by someone else entirely.</em></p>
      <p>Here is a line that trails off without any ending</p>`));
    expect(storyParagraphs(doc)).toEqual([[[LONG_A], ["A sentence with a link inside it is still prose."]]]);
  });

  it("ends a run at whatever it skips, so passages never jump over it", () => {
    const doc = parse(story(`<p>${LONG_A}</p><p>MARTÍNEZ: And what did the council decide in the end?</p><p>(SOUNDBITE OF MUSIC)</p><p>🎵 Music: three rappers offer ways to relight a flickering star.</p><p>${LONG_B}</p>`));
    expect(storyParagraphs(doc)).toEqual([[[LONG_A]], [[LONG_B]]]);
  });

  it("separates touching sentences and stops at a plug", () => {
    const doc = parse(story(`<p>The pope lived there for decades.<br>He served as a bishop in the north. Support public media with NPR+ and enjoy perks. Learn more online.</p>`));
    expect(storyParagraphs(doc)).toEqual([[["The pope lived there for decades.", "He served as a bishop in the north."]]]);
  });

  it("doesn't end a sentence at an abbreviation", () => {
    const doc = parse(story(`<p>Steve Cherundolo will take over as interim head coach while U.S. Soccer searches for a permanent replacement.</p>`));
    expect(storyParagraphs(doc)).toEqual([[["Steve Cherundolo will take over as interim head coach while U.S. Soccer searches for a permanent replacement."]]]);
  });
});

describe("passages", () => {
  it("runs whole sentences from a paragraph start until there are enough words", () => {
    const options = passages([[[LONG_A], [LONG_B], [LONG_C]]]);
    expect(options[0]).toBe(`${LONG_A} ${LONG_B}`);
    for (const p of options) {
      expect(count(p)).toBeGreaterThanOrEqual(MIN_WORDS);
      expect(count(p)).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  it("doesn't join separate runs", () => {
    expect(passages([[[LONG_A]], [[LONG_B]]])).toEqual([]);
  });

  it("drops a passage too short to reach the minimum", () => {
    expect(passages([[["Short and sweet."]]])).toEqual([]);
  });

  it("drops a passage that runs past the maximum", () => {
    const rambling = `${Array.from({ length: MAX_WORDS + 5 }, () => "word").join(" ")}.`;
    expect(passages([[[rambling]]])).toEqual([]);
  });
});

describe("scriptFromStory", () => {
  it("returns a passage with the story's title and npr.org link", () => {
    const script = scriptFromStory(story(`<p>${LONG_A}</p><p>${LONG_B}</p><p>${LONG_C}</p>`), "nx-s1-1", () => 0);
    expect(script).toEqual({ text: `${LONG_A} ${LONG_B}`, title: "Council weighs new bike lanes", url: "https://www.npr.org/nx-s1-1" });
  });

  it("is null for a story with no run of prose", () => {
    expect(scriptFromStory(story(`<p><em>Music: credits only, nothing else to read here.</em></p>`), "nx-s1-1")).toBeNull();
  });
});

describe("nprReadingScript", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetReadingScripts(); });

  const serve = (pages: Record<string, string>) => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost").searchParams.get("url") ?? "";
      fetched.push(url);
      return url in pages ? new Response(pages[url]) : new Response("missing", { status: 502 });
    }));
    return fetched;
  };

  it("skips stories without a passage and avoids the one shown last", async () => {
    const fetched = serve({
      "https://text.npr.org/1001": SECTION,
      "https://text.npr.org/nx-s1-2": story(`<p>${LONG_A}</p><p>${LONG_B}</p>`),
    });
    const script = await nprReadingScript({ avoid: "https://www.npr.org/nx-s1-1", random: () => 0 });
    expect(script.url).toBe("https://www.npr.org/nx-s1-2");
    expect(fetched).not.toContain("https://text.npr.org/nx-s1-1");
    // The story list is reused.
    await nprReadingScript({ avoid: "https://www.npr.org/nx-s1-1" });
    expect(fetched.filter((u) => u.endsWith("/1001"))).toHaveLength(1);
  });

  it("fails clearly when NPR is unreachable", async () => {
    serve({});
    await expect(nprReadingScript()).rejects.toThrow("NPR returned 502");
  });
});
