import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocRecord } from "./db";
import { diagramDescription, drawDiagram, hasDiagram, jsonObject, parseDiagram, savedDiagram, type DiagramSpec } from "./articleDiagram";
import { summarySource } from "./summary";

const rec = (text: string, diagram?: DocRecord["diagram"]): DocRecord =>
  ({ id: "d", title: "T", text, diagram, source: "url", domain: "example.com", voice: null, chars: text.length, createdAt: 0, updatedAt: 0 });
const flow: DiagramSpec = { type: "flow", title: "How a request is served", items: [{ label: "Parse" }, { label: "Plan", note: "Choose an index" }, { label: "Run" }], focus: 1 };
const reply = (content: string, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { content } }] });

describe("parseDiagram", () => {
  it("keeps a well-formed diagram", () => {
    expect(parseDiagram(flow)).toEqual(flow);
    expect(parseDiagram({ type: "none", reason: "It is a personal essay." })).toEqual({ type: "none", reason: "It is a personal essay." });
  });

  it("rejects unknown shapes, missing titles, and item counts outside a shape's range", () => {
    expect(parseDiagram({ ...flow, type: "mindmap" })).toBeNull();
    expect(parseDiagram({ ...flow, type: "toString" })).toBeNull();
    expect(parseDiagram({ ...flow, title: "  " })).toBeNull();
    expect(parseDiagram({ ...flow, items: [{ label: "One" }] })).toBeNull();
    expect(parseDiagram({ ...flow, type: "cycle", items: flow.type === "flow" ? flow.items.slice(0, 2) : [] })).toBeNull();
    expect(parseDiagram({ type: "hub", title: "T", items: [{ label: "a" }, { label: "b" }, { label: "c" }] })).toBeNull();
    expect(parseDiagram({ type: "compare", title: "T", groups: [{ label: "Only", points: ["x"] }] })).toBeNull();
    expect(parseDiagram("flow")).toBeNull();
  });

  it("cleans labels to plain, short text and drops a focus that points nowhere", () => {
    const parsed = parseDiagram({
      type: "flow", title: "**Bold** <b>title</b>", focus: 9,
      items: [{ label: "See https://example.com now", note: 7 }, { label: "A very long label that goes on far past the forty character budget" }, { label: "" }],
    });
    expect(parsed).toEqual({ type: "flow", title: "Bold title", items: [
      { label: "See now" },
      { label: "A very long label that goes on far past…" },
    ] });
  });

  it("caps compare points", () => {
    const parsed = parseDiagram({ type: "compare", title: "T", groups: [
      { label: "A", points: ["1", "2", "3", "4", "5", "6"] }, { label: "B", points: ["", "x"] },
    ] });
    expect(parsed).toMatchObject({ groups: [{ points: ["1", "2", "3", "4", "5"] }, { points: ["x"] }] });
  });
});

describe("diagramDescription", () => {
  it("says only what is drawn", () => {
    expect(diagramDescription(flow)).toBe("Diagram: How a request is served. A process in 3 steps. First, Parse. Then, Plan: Choose an index. Finally, Run.");
    expect(diagramDescription({ type: "cycle", title: "Loop", items: [{ label: "A" }, { label: "B" }, { label: "C" }] }))
      .toContain("Then C leads back to A.");
    expect(diagramDescription({ type: "compare", title: "Two ways", groups: [{ label: "SQL", points: ["Tables."] }, { label: "NoSQL", points: ["Documents"] }] }))
      .toBe("Diagram: Two ways. A comparison of SQL and NoSQL. SQL: Tables. NoSQL: Documents.");
  });
});

describe("drawDiagram", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads a fenced JSON reply and saves it against the text it was drawn from", async () => {
    const fetch = vi.fn(async () => reply("```json\n" + JSON.stringify(flow) + "\n```"));
    vi.stubGlobal("fetch", fetch);
    const saved = await drawDiagram(rec("Body."), "glm-5.3");
    expect(saved).toMatchObject({ source: summarySource("Body."), spec: flow, model: "glm-5.3", version: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/llm/v1/chat/completions");
    expect((init.headers as Record<string, string>)["x-opencode-session"]).toBe("readaloud-diagram-d");
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).not.toContain("do not return \"none\"");
    expect(body.messages[1].content).toBe("Title: T\n\nBody.");
    expect(hasDiagram(rec("Body.", saved))).toBe(true);
    expect(savedDiagram(rec("Body.", saved))).toEqual(flow);
    expect(hasDiagram(rec("Changed.", saved))).toBe(false);
  });

  it("asks for a diagram regardless when forced, and refuses a decline then", async () => {
    const fetch = vi.fn(async () => reply(JSON.stringify({ type: "none", reason: "Nothing to draw." })));
    vi.stubGlobal("fetch", fetch);
    await expect(drawDiagram(rec("Body."), "glm-5.3", { force: true })).rejects.toThrow("couldn't be drawn");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).messages[0].content).toContain("do not return \"none\"");
    fetch.mockClear();
    await expect(drawDiagram(rec("Body."), "glm-5.3")).resolves.toMatchObject({ spec: { type: "none" } });
  });

  it("fails on a cut-off or unusable reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(JSON.stringify(flow), "length")));
    await expect(drawDiagram(rec("Body."), "glm-5.3")).rejects.toThrow("incomplete");
    vi.stubGlobal("fetch", vi.fn(async () => reply("Here is a flowchart of the article.")));
    await expect(drawDiagram(rec("Body."), "glm-5.3")).rejects.toThrow("couldn't be drawn");
    await expect(drawDiagram(rec("  "), "glm-5.3")).rejects.toThrow("no text");
  });

  it("gives a reply that breaks a limit one more try, showing the model its reply", async () => {
    const tooMany = JSON.stringify({ type: "flow", title: "T", items: Array.from({ length: 9 }, (_, i) => ({ label: `S${i}` })) });
    const fetch = vi.fn().mockResolvedValueOnce(reply(tooMany)).mockResolvedValueOnce(reply(JSON.stringify(flow)));
    vi.stubGlobal("fetch", fetch);
    await expect(drawDiagram(rec("Body."), "glm-5.3")).resolves.toMatchObject({ spec: flow });
    const retry = JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).messages;
    expect(retry.slice(2)).toEqual([{ role: "assistant", content: tooMany }, { role: "user", content: expect.stringContaining("can't be drawn") }]);
  });

  it("finds the object in a reply with words around it", () => {
    expect(jsonObject('Sure: {"type":"none","reason":"x"} done')).toEqual({ type: "none", reason: "x" });
    expect(jsonObject("no json")).toBeNull();
  });
});
