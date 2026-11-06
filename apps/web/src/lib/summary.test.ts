import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocRecord } from "./db";

const rec = (text: string, summary?: DocRecord["summary"]): DocRecord =>
  ({ id: "d", title: "T", text, summary, source: "url", domain: "example.com", voice: null, chars: text.length, createdAt: 0, updatedAt: 0 });

async function load() {
  vi.resetModules();
  return import("./summary");
}

describe("summary", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reuses a summary only while the text is unchanged", async () => {
    const { hasSummary, summarySource } = await load();
    const summary = { source: summarySource("Hi"), text: "Greeting.", model: "glm-5.3", version: 1, createdAt: 1 };
    expect(hasSummary(rec("Hi", summary))).toBe(true);
    expect(hasSummary(rec("Hello", summary))).toBe(false);
    expect(hasSummary(rec("Hi", { ...summary, version: 0 }))).toBe(false);
    expect(hasSummary(rec("Hi"))).toBe(false);
  });

  it("sends the article with a per-document session and returns the completed summary", async () => {
    const { summarize, summarySource } = await load();
    const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "  Main point.\n\nDetail.  " } }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await summarize(rec("Body text."), "glm-5.3");
    expect(result).toMatchObject({ source: summarySource("Body text."), text: "Main point.\n\nDetail.", model: "glm-5.3", version: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/llm/v1/chat/completions");
    expect((init.headers as Record<string, string>)["x-opencode-session"]).toBe("readaloud-summary-d");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("glm-5.3");
    expect(body.messages[1].content).toBe("Title: T\n\nBody text.");
  });

  it("rejects truncated output and reports upstream errors", async () => {
    const { summarize } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "length", message: { content: null } }] })));
    await expect(summarize(rec("Body."), "glm-5.3")).rejects.toThrow("incomplete");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ type: "error", error: { message: "Usage limit reached" } }, { status: 429 })));
    await expect(summarize(rec("Body."), "glm-5.3")).rejects.toThrow("Usage limit reached");
  });
});
