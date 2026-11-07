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
