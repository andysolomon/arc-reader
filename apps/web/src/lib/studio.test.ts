import { describe, it, expect, vi, afterEach } from "vitest";
import { errorMessage, readEvents, waitForTask, subtitles, transcribe } from "./studio";

function stream(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { parts.forEach((part) => controller.enqueue(encoder.encode(part))); controller.close(); } }));
}
afterEach(() => vi.unstubAllGlobals());
describe("VoiceStudio workflow contracts", () => {
  it("handles split SSE frames, CRLF and keepalives", async () => {
    const events: string[] = [];
    await readEvents(stream([': ping\r\n\r\nda', 'ta: {"type":"progress"}\r', '\n\r\ndata: {"type":"done"}\n\n']), (event) => { events.push(event.type!); });
    expect(events).toEqual(["progress", "done"]);
  });
  it("rejects streamed task failures and cancelled jobs", async () => {
    await expect(readEvents(stream(['event: error\ndata: {"detail":{"message":"Missing model"}}\n\n']), () => {})).rejects.toThrow("Missing model");
    await expect(readEvents(stream(['data: {"type":"cancelled"}\n\n']), () => {})).rejects.toThrow("cancelled");
  });
  it("does not mark a disconnected task as finished", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream(['data: {"type":"progress"}\n\n'])));
    await expect(waitForTask("dub-1", new AbortController().signal, () => {})).rejects.toThrow("disconnected");
  });
  it("finishes ingest only after ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream(['data: {"type":"extract_done"}\n\ndata: {"type":"ready"}\n\n'])));
    await expect(waitForTask("dub-1", new AbortController().signal, () => {}, "ready")).resolves.toBeUndefined();
  });
  it("preserves actionable nested and validation error messages", () => {
    expect(errorMessage({ detail: { message: "Download Whisper first" } })).toBe("Download Whisper first");
    expect(errorMessage({ detail: [{ msg: "Audio required" }] })).toBe("Audio required");
  });
  it("sends a playable recording with dictation mode, without a browser API key", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "Hello" })));
    vi.stubGlobal("fetch", fetch);
    await transcribe(new File(["audio"], "recording.webm"), true, new AbortController().signal);
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe("/api/vs/transcribe");
    expect(init.body.get("dictation")).toBe("true");
    expect(init.body.get("mode")).toBe("accurate");
    expect(init.body.get("audio").name).toBe("recording.webm");
    expect(init.headers).toBeUndefined();
  });
  it("formats subtitle timing across minute and hour boundaries", () => {
    expect(subtitles([{ start: 59.9996, end: 3600.01, text: "Hello" }])).toBe("1\n00:01:00,000 --> 01:00:00,010\nHello\n");
  });
});
