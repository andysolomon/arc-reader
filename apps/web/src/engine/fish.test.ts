import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowser, replies, serve } from "./fakeSpeech";
import { apiSynthesize, cacheKey, fetchFishVoices, fishSynthesize, synthesize } from "./providers";
import { ApiBusy, ApiRejected } from "./types";
import { audioCache } from "../lib/db";
import { getUsageSnapshot } from "../lib/usage";

const browser = installBrowser();
let server = serve(replies());
beforeEach(async () => { browser.clearStorage(); await audioCache.clear(); server = serve(replies()); });
afterEach(() => { vi.unstubAllEnvs(); });

const req = { text: "Hello from Fish Audio.", voice: "fish:voice-123", engine: "fish" };
const audio = () => new Response(new Uint8Array(64), { headers: { "Content-Type": "audio/mpeg" } });
const usage = () => getUsageSnapshot().rows;

describe("Fish Audio", () => {
  it("routes speech to Fish with its reference ID, selected model and fixed speed, and bills it by UTF-8 byte", async () => {
    server = serve(replies(audio()));
    const chunk = await apiSynthesize({ ...req, signal: new AbortController().signal });
    const [sent, ...rest] = server.sent;
    expect(rest).toEqual([]);
    expect(sent).toMatchObject({ url: "/api/fish/v1/tts", method: "POST", body: { text: req.text, reference_id: "voice-123", format: "mp3", prosody: { speed: 1 } } });
    expect(Object.fromEntries(sent.headers)).toEqual({ "content-type": "application/json", accept: "audio/mpeg", model: "s2.1-pro" });
    expect(chunk).toMatchObject({ source: "api", mime: "audio/mpeg" });
    expect(chunk.duration).toBeGreaterThan(0);
    const [row] = usage();
    expect(row).toMatchObject({ provider: "fish", model: "s2.1-pro", requests: 1, bytes: req.text.length, pricing: "$15 / 1M UTF-8 bytes" });
    expect(row.costUsd).toBeCloseTo(req.text.length * 15 / 1e6, 12);
  });

  it("keeps Fish routing independent of the legacy VoiceStudio contract", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_TTS_PROVIDER", "readaloud");
    const providers = await import("./providers");
    server = serve(replies(audio()));
    await providers.apiSynthesize(req);
    expect(server.sent.map((s) => s.url)).toEqual(["/api/fish/v1/tts"]);
  });

  it("plays its cached audio without paying for it again, and never another model's or engine's", async () => {
    server = serve(replies(audio(), audio(), audio()));
    await synthesize(req);
    expect((await synthesize(req)).source).toBe("cache");
    expect(server.generated()).toHaveLength(1);
    expect(usage()).toEqual([expect.objectContaining({ requests: 1 })]);
    expect((await synthesize({ ...req, engine: "openai" })).source).toBe("api");
    vi.resetModules();
    vi.stubEnv("VITE_FISH_TTS_MODEL", "s1");
    const otherModel = await import("./providers");
    expect((await otherModel.synthesize(req)).source).toBe("api");
    expect(server.generated().at(-1)!.headers.get("model")).toBe("s1");
    expect(await audioCache.get(cacheKey(req))).toBeDefined();
  });

  it("tells the reader the account is out of credit, reads with the browser voice, and blames no other provider", async () => {
    const noCredit = () => Response.json({ message: "Insufficient balance" }, { status: 402 });
    server = serve(replies(noCredit(), noCredit()));
    const onRejected = vi.fn(), onOffline = vi.fn();
    const c = await synthesize({ ...req, onRejected, onOffline });
    expect(c.source).toMatch(/local|estimate/);
    expect(onRejected).toHaveBeenCalledExactlyOnceWith("Insufficient balance");
    expect(onOffline).not.toHaveBeenCalled();
    expect(usage()).toEqual([]);
    expect(await audioCache.get(cacheKey(req))).toBeUndefined();
    // A caller that won't fall back hears the same reason.
    await expect(synthesize({ ...req, fallbackLocal: false })).rejects.toThrow("Insufficient balance");
  });

  it("rejects empty audio, HTML responses, invalid keys, and rate limits", async () => {
    server = serve(replies(
      new Response(""),
      new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } }),
      new Response("", { status: 401 }),
      new Response("", { status: 429 }),
    ));
    await expect(fishSynthesize(req)).rejects.toBeInstanceOf(ApiRejected);
    await expect(fishSynthesize(req)).rejects.toThrow("no playable audio");
    await expect(fishSynthesize(req)).rejects.toThrow("rejected the API key");
    await expect(fishSynthesize(req)).rejects.toBeInstanceOf(ApiBusy);
    expect(usage()).toEqual([]);
  });

  it("does not send cancelled requests or retry an abort as a local voice", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(synthesize({ ...req, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(server.sent).toEqual([]);
  });

  it("loads voice metadata and drops malformed entries", async () => {
    server = serve(replies(Response.json({ items: [{ _id: "v1", title: "Narrator", languages: ["en"] }, { title: "Missing ID" }] })));
    expect(await fetchFishVoices()).toEqual([{ _id: "v1", title: "Narrator", languages: ["en"] }]);
    expect(server.sent[0].url).toContain("/api/fish/model?");
  });
});
