import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowser, replies, serve, speech } from "./fakeSpeech";
import { apiSynthesize, cacheKey, fetchPhononVoices, hasOwnServer, isPaidEngine, prepareInBackground, preparesOnServer, synthesize } from "./providers";
import { ApiRejected } from "./types";
import { audioCache } from "../lib/db";
import { getUsageSnapshot } from "../lib/usage";

const browser = installBrowser();
let server = serve(replies());
beforeEach(async () => { browser.clearStorage(); await audioCache.clear(); server = serve(replies()); });
afterEach(() => { vi.unstubAllEnvs(); });

const req = { text: "Hello from Phonon.", voice: "phonon:Captain Silas Blackwater", engine: "phonon" };
const urls = () => server.sent.map((s) => s.url);

describe("Phonon", () => {
  it("sends speech to its own server with the voice's name and the loaded model, and records it as free", async () => {
    server = serve(replies(speech()));
    const chunk = await apiSynthesize(req);
    expect(urls()).toEqual(["/api/phonon/v1/audio/speech"]);
    expect(server.sent[0].body).toEqual({ model: "gradium/phonon-31m-en", input: req.text, voice: "Captain Silas Blackwater", response_format: "mp3", speed: 1 });
    expect(chunk).toMatchObject({ source: "api", mime: "audio/wav" });
    expect(getUsageSnapshot().rows).toEqual([expect.objectContaining({ provider: "phonon", model: "gradium/phonon-31m-en", requests: 1, costUsd: null })]);
  });

  it("is free and queues on its own: one request at a time, never behind VoiceStudio", async () => {
    expect(isPaidEngine("phonon")).toBe(false);
    expect(hasOwnServer("phonon")).toBe(true);
    expect(hasOwnServer("kittentts")).toBe(false);
    const release: (() => void)[] = [];
    server = serve(() => new Promise<Response>((resolve) => { release.push(() => resolve(speech())); }));
    // A slow VoiceStudio request is in flight; Phonon does not wait for it.
    const studio = apiSynthesize({ text: "A VoiceStudio passage.", voice: "expr-voice-2-f", engine: "kittentts" });
    const first = apiSynthesize(req);
    const second = apiSynthesize({ ...req, text: "A second passage." });
    await vi.waitFor(() => expect(urls()).toEqual(["/api/vs/v1/audio/speech", "/api/phonon/v1/audio/speech"]));
    // The server refuses a second clip while it is generating one, so the second waits its turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.sent).toHaveLength(2);
    release[1]();
    await first;
    await vi.waitFor(() => expect(server.sent).toHaveLength(3));
    expect(server.sent[2].body).toMatchObject({ input: "A second passage." });
    release[2](); release[0]();
    await Promise.all([second, studio]);
  });

  it("asks again when the server is busy with another device's clip", async () => {
    server = serve(replies(Response.json({ error: { code: "server_busy", message: "the server is busy" } }, { status: 429 }), speech()));
    expect(await apiSynthesize(req)).toMatchObject({ source: "api" });
    expect(server.generated()).toHaveLength(2);
  });

  it("replays cached audio without a request, but never a clip from another Phonon model", async () => {
    server = serve(replies(speech(), speech()));
    await synthesize(req);
    expect((await synthesize(req)).source).toBe("cache");
    expect(server.generated()).toHaveLength(1);
    vi.resetModules();
    vi.stubEnv("VITE_PHONON_TTS_MODEL", "gradium/phonon-62m-en");
    const otherModel = await import("./providers");
    expect((await otherModel.synthesize(req)).source).toBe("api");
    expect(server.generated().map((s) => (s.body as { model: string }).model)).toEqual(["gradium/phonon-31m-en", "gradium/phonon-62m-en"]);
  });

  it("is prepared by the web server on the Phonon server, like VoiceStudio's free voices", async () => {
    expect(preparesOnServer("phonon")).toBe(true);
    expect(preparesOnServer("kittentts")).toBe(true);
    expect(preparesOnServer("openai")).toBe(false);
    server = serve((sent) => sent.method === "POST"
      ? Response.json({ id: "job-1", state: "running", done: 0, total: 2 }, { status: 202 })
      : Response.json({ id: "job-1", state: "done", done: 2, total: 2, worker: "Phonon" }));
    const progress = vi.fn();
    const other = { ...req, text: "Another passage." };
    await prepareInBackground([req, other], 0, progress);
    expect(server.sent[0]).toMatchObject({ url: "/api/preparations", method: "POST" });
    expect((server.sent[0].body as { requests: unknown[] }).requests).toEqual([req, other].map((r) => ({ key: cacheKey(r), text: r.text, voice: r.voice, engine: "phonon", protocol: "openai", cached: false })));
    expect(progress).toHaveBeenLastCalledWith(2, 2, expect.objectContaining({ worker: "Phonon" }));
    // Nothing was generated from the device.
    expect(urls().every((url) => url.startsWith("/api/preparations"))).toBe(true);
  });

  it("plays the passage the server is preparing instead of asking Phonon for it a second time", async () => {
    const opening = { ...req, text: "The passage being played." };
    server = serve((sent) => sent.method === "POST" ? Response.json({ id: "job-2", state: "running", done: 0, total: 1 }, { status: 202 })
      : sent.url.endsWith("/audio/0") ? speech() : Response.json({ id: "job-2", state: "done", done: 1, total: 1 }));
    // Opening a reading starts its preparation and playback in the same moment.
    const preparing = prepareInBackground([opening], 0);
    const chunk = await synthesize(opening);
    await preparing;
    expect(chunk.audio).toBeDefined();
    expect(urls()).toContain("/api/preparations/job-2/audio/0");
    expect(server.generated()).toEqual([]);
  });

  it("lists the server's voice names and rejects anything that is not a list", async () => {
    server = serve(replies(Response.json({ aliases: {}, voices: ["Alfie", "default", 7, ""] }), Response.json({ voices: "Alfie" })));
    expect(await fetchPhononVoices()).toEqual(["Alfie", "default"]);
    expect(urls()[0]).toBe("/api/phonon/v1/audio/voices");
    await expect(fetchPhononVoices()).rejects.toBeInstanceOf(ApiRejected);
  });
});
