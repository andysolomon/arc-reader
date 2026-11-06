import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCodeSummaries } from "./codeSummaries";
import { codeKey } from "./codeBlocks";
import { segment, planPassages } from "./segment";
import type { DocRecord } from "./db";
const code = "const n = 1;\nconsole.log(n);";
const key = codeKey({ text: code, language: "js" });
const rec: DocRecord = { id: "d", title: "Example", text: `Introduction.\n\n\`\`\`js\n${code}\n\`\`\`\n\nDone.`, source: "paste", domain: "", voice: null, chars: 50, createdAt: 0, updatedAt: 0 };
const explain = (record = rec, signal = new AbortController().signal) => prepareCodeSummaries(record, record.text, "glm-5.3", signal, vi.fn());
const response = (content: string) => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });

afterEach(() => vi.unstubAllGlobals());

describe("spoken code explanations", () => {
  it("generates and reuses a summary with identical playback and preparation passages", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(response(JSON.stringify({ [key]: "This example assigns a number and prints it." })));
    vi.stubGlobal("fetch", fetch);
    const prepared = await explain();
    expect(prepared.text).toBe(rec.text);
    expect(prepared.codeSummaries?.[key]).toBe("This example assigns a number and prints it.");
    expect(await explain(prepared)).toBe(prepared);
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(JSON.parse(body.messages[1].content).blocks[0]).toMatchObject({ id: key, code, context: "Introduction." });
    const passages = planPassages(segment(prepared.text, prepared.codeSummaries).sentences);
    expect(passages[1].text).toBe(prepared.codeSummaries?.[key]);
    expect(passages.map((p) => p.text).join(" ")).not.toContain(code);
  });

  it.each(["no key", "network", "invalid", "raw code", "truncated"])("falls back safely on %s", async (mode) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: mode !== "no key" }));
    if (mode === "network") fetch.mockRejectedValueOnce(new Error("offline"));
    else if (mode === "truncated") fetch.mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }));
    else fetch.mockResolvedValueOnce(response(mode === "raw code" ? JSON.stringify({ [key]: code }) : "invalid json"));
    vi.stubGlobal("fetch", fetch);
    const result = await explain();
    expect(result).toBe(rec);
    expect(segment(result.text, result.codeSummaries).sentences[1].text).toContain("skip the code");
  });

  it("coalesces concurrent voices while letting a cancelled consumer leave immediately", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const a = explain(rec, controller.signal);
    const b = explain();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(a).rejects.toThrow();
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
    finish(response(JSON.stringify({ [key]: "This code prints a number." })));
    expect((await b).codeSummaries?.[key]).toBe("This code prints a number.");
  });

  it("does not contact a provider for prose or oversized code", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await explain({ ...rec, text: "Ordinary prose." });
    await explain({ ...rec, text: '```\n' + "x".repeat(20_001) + '\n```' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
