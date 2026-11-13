import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareVisualDescriptions } from "./visualDescriptions";
import { visualBlock, visualKey, type ArticleVisual } from "./visuals";
import { segment } from "./segment";
import type { DocRecord } from "./db";
const visual: ArticleVisual = { kind: "diagram", src: "https://example.com/diagram.png", alt: "Flow diagram", caption: "Input becomes output." };
const rec: DocRecord = { id: "v", title: "Process", text: `Before.\n\n${visualBlock(visual)}\n\nAfter.`, source: "url", domain: "example.com", voice: null, chars: 50, createdAt: 0, updatedAt: 0 };
const description = "The diagram shows input passing through a processor to produce output.";
const response = (text = description) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const prepare = (record = rec, signal = new AbortController().signal) => prepareVisualDescriptions(record, record.text, signal, vi.fn());
afterEach(() => vi.unstubAllGlobals());

describe("image understanding", () => {
  it("sends actual image input with bounded context and saves a reusable explanation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    const prepared = await prepare();
    expect(prepared.text).toBe(rec.text);
    expect(prepared.visualDescriptions?.[visualKey(visual)]).toBe(description);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("/api/llm/v1/responses");
    const body = JSON.parse(init.body);
    expect(body.store).toBe(false);
    expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: visual.src, detail: "auto" });
    expect(JSON.parse(body.input[0].content[0].text)).toMatchObject({ title: "Process", caption: visual.caption, context: "Before." });
    expect(await prepare(prepared)).toBe(prepared);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(segment(prepared.text, {}, prepared.visualDescriptions).sentences[1].text).toBe(description);
  });
  it.each(["missing key", "unreachable", "refusal", "incomplete", "bad description"])("falls back to article metadata on %s", async (mode) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: mode !== "missing key" }));
    if (mode === "unreachable") fetch.mockRejectedValueOnce(new Error("offline"));
    else if (mode === "refusal") fetch.mockResolvedValueOnce(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot see image" }] }] }));
    else if (mode === "incomplete") fetch.mockResolvedValueOnce(Response.json({ status: "incomplete" }));
    else fetch.mockResolvedValueOnce(response("https://example.com/image.png"));
    vi.stubGlobal("fetch", fetch);
    expect(await prepare()).toBe(rec);
    expect(segment(rec.text).sentences[1].text).toContain("description from the article");
  });
  it("a broken image does not prevent another image from being described", async () => {
    const other = { ...visual, src: "https://example.com/other.png" };
    const record = { ...rec, text: rec.text + '\n\n' + visualBlock(other) };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(new Response("unavailable", { status: 400 })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    const prepared = await prepare(record);
    expect(prepared.visualDescriptions?.[visualKey(other)]).toBe(description);
    expect(prepared.visualDescriptions?.[visualKey(visual)]).toBeUndefined();
  });
  it("counts the descriptions done so a bar can show how far along they are", async () => {
    const other = { ...visual, src: "https://example.com/other.png" };
    const record = { ...rec, text: rec.text + '\n\n' + visualBlock(other) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(new Response("unavailable", { status: 400 })).mockResolvedValueOnce(response()));
    const progress = vi.fn();
    await prepareVisualDescriptions(record, record.text, new AbortController().signal, progress);
    expect(progress.mock.calls.map(([, step]) => step)).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
  });
  it("cancellation stops waiting and does not save partial descriptions", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    vi.stubGlobal("fetch", fetch);
    const task = prepare(rec, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(task).rejects.toThrow();
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });
});

describe("describing a deck's slides", () => {
  const slide = (page: number): ArticleVisual => ({ kind: "slide", src: `/api/slides/${"a".repeat(32)}/${page}.jpg`, alt: `Slide ${page}: Topic ${page}`, caption: "" });
  const deck = (pages: number): DocRecord => ({ ...rec, id: "deck", title: "Agent Design",
    text: Array.from({ length: pages }, (_, i) => `## Topic ${i + 1}\n\n${visualBlock(slide(i + 1))}\n\nWhat slide ${i + 1} says.`).join("\n\n") });
  /** Answers each slide with a description naming its page, and records the order they were asked in. */
  const model = () => {
    const asked: number[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/llm/config") return Response.json({ configured: true });
      if (url.startsWith("/api/slides/")) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
      const page = Number(JSON.parse(JSON.parse(init!.body as string).input[0].content[0].text).slide.match(/Slide (\d+)/)[1]);
      asked.push(page);
      return response(`Slide ${page} shows a diagram of its topic.`);
    });
    vi.stubGlobal("fetch", fetch);
    return { asked, fetch };
  };

  it("sends the slide's picture itself, with the words that will follow it", async () => {
    const { fetch } = model();
    const prepared = await prepareVisualDescriptions(deck(2), deck(2).text, new AbortController().signal, vi.fn(), { all: true });
    expect(prepared.visualDescriptions).toEqual({ [visualKey(slide(1))]: "Slide 1 shows a diagram of its topic.", [visualKey(slide(2))]: "Slide 2 shows a diagram of its topic." });
    const body = JSON.parse(fetch.mock.calls.find(([url]) => url === "/api/llm/v1/responses")![1]!.body as string);
    // The model cannot reach this server, so it is given the picture, not its address.
    expect(body.input[0].content[1].image_url).toBe("data:image/jpeg;base64,/9j/");
    expect(body.instructions).toContain("one slide from a lecture deck");
    // Not the next slide's title or words.
    expect(JSON.parse(body.input[0].content[0].text)).toEqual({ deck: "Agent Design", slide: "Slide 1: Topic 1", text: "What slide 1 says." });
  });

  it("describes every slide when asked to, from the listener's place on, and a handful otherwise", async () => {
    const some = model();
    const few = await prepareVisualDescriptions(deck(20), deck(20).text, new AbortController().signal, vi.fn());
    expect(Object.keys(few.visualDescriptions ?? {})).toHaveLength(8);
    expect(some.asked).toHaveLength(8);
    const all = model();
    const whole = await prepareVisualDescriptions(deck(20), deck(20).text, new AbortController().signal, vi.fn(), { all: true, heard: () => 12 });
    expect(Object.keys(whole.visualDescriptions ?? {})).toHaveLength(20);
    // Three at a time, beginning with the slide being listened to, then back round to the start.
    expect(all.asked.slice(0, 3).sort((a, b) => a - b)).toEqual([13, 14, 15]);
    expect(all.asked.slice(8).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("hands over the first description at once and the rest as they come", async () => {
    model();
    const batches: string[][] = [];
    const whole = await prepareVisualDescriptions(deck(6), deck(6).text, new AbortController().signal, vi.fn(), { all: true, found: (found) => { batches.push(Object.values(found)); } });
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches[0]).toHaveLength(1);
    expect(batches.flat().sort()).toEqual(Object.values(whole.visualDescriptions ?? {}).sort());
    // An article's pictures still arrive together.
    const article: ArticleVisual[] = [1, 2, 3].map((n) => ({ kind: "image", src: `https://example.com/${n}.png`, alt: "", caption: "" }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/llm/config" ? Response.json({ configured: true }) : response()));
    const together: number[] = [];
    const record = { ...rec, text: article.map(visualBlock).join("\n\nBetween.\n\n") };
    await prepareVisualDescriptions(record, record.text, new AbortController().signal, vi.fn(), { all: true, found: (found) => { together.push(Object.keys(found).length); } });
    expect(together).toEqual([3]);
  });
});
