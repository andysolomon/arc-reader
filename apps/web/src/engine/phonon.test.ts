import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiSynthesize, cacheKey, fetchPhononVoices, hasOwnServer, isPaidEngine, preparationRequests, prepareInBackground, preparesOnServer, synthesize } from "./providers";
import { ApiRejected } from "./types";
import { audioCache } from "../lib/db";
import { addUsage } from "../lib/usage";

vi.mock("../lib/db", () => ({ audioCache: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } }));
vi.mock("../lib/usage", async (importOriginal) => ({ ...await importOriginal<typeof import("../lib/usage")>(), addUsage: vi.fn() }));
const req = { text: "Hello from Phonon.", voice: "phonon:Captain Silas Blackwater", engine: "phonon" };
const audio = () => new Response(new Uint8Array(64), { headers: { "Content-Type": "audio/mpeg" } });
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Phonon", () => {
  it("sends speech to its own server with the voice's name and the loaded model", async () => {
    fetchMock.mockResolvedValueOnce(audio());
    const chunk = await apiSynthesize(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/phonon/v1/audio/speech");
    expect(JSON.parse(init.body)).toEqual({ model: "gradium/phonon-31m-en", input: req.text, voice: "Captain Silas Blackwater", response_format: "mp3", speed: 1 });
    expect(chunk).toMatchObject({ source: "api", mime: "audio/mpeg" });
    expect(addUsage).toHaveBeenCalledWith(expect.objectContaining({ engine: "phonon", model: "gradium/phonon-31m-en" }));
  });

  it("is free and queues on its own: one request at a time, never behind VoiceStudio", async () => {
    expect(isPaidEngine("phonon")).toBe(false);
    expect(hasOwnServer("phonon")).toBe(true);
    expect(hasOwnServer("kittentts")).toBe(false);
    const release: (() => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { release.push(() => resolve(audio())); }));
    const called = () => fetchMock.mock.calls.map(([url]) => url);
    // A slow VoiceStudio request is in flight; Phonon does not wait for it.
    const studio = apiSynthesize({ text: "A VoiceStudio passage.", voice: "expr-voice-2-f", engine: "kittentts" });
    const first = apiSynthesize(req);
    const second = apiSynthesize({ ...req, text: "A second passage." });
    await vi.waitFor(() => expect(called()).toEqual(["/api/vs/v1/audio/speech", "/api/phonon/v1/audio/speech"]));
    // The server refuses a second clip while it is generating one, so the second waits its turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release[1]();
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).input).toBe("A second passage.");
    release[2](); release[0]();
    await Promise.all([second, studio]);
  });

  it("asks again when the server is busy with another device's clip", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "server_busy", message: "the server is busy" } }, { status: 429 }));
    fetchMock.mockResolvedValueOnce(audio());
    expect(await apiSynthesize(req)).toMatchObject({ source: "api" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes the model in cache identity and replays cached audio without a request", async () => {
    expect(cacheKey(req)).toContain("phonon:gradium/phonon-31m-en|phonon:Captain Silas Blackwater|");
    vi.mocked(audioCache.get).mockResolvedValueOnce({ key: cacheKey(req), blob: new Blob(["audio"]), mime: "audio/mpeg", duration: 1, createdAt: 0 });
    expect((await synthesize(req)).source).toBe("cache");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is prepared by the web server on the Phonon server, like VoiceStudio's free voices", async () => {
    expect(preparesOnServer("phonon")).toBe(true);
    expect(preparesOnServer("kittentts")).toBe(true);
    expect(preparesOnServer("openai")).toBe(false);
    expect(preparationRequests([req])).toEqual([{ key: cacheKey(req), text: req.text, voice: req.voice, engine: "phonon", profile: undefined, protocol: "openai" }]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ id: "job-1", state: "running", done: 0, total: 2 }, { status: 202 })
      : Response.json({ id: "job-1", state: "done", done: 2, total: 2, worker: "Phonon" }));
    const progress = vi.fn();
    await prepareInBackground([req, { ...req, text: "Another passage." }], 0, progress);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/preparations");
    expect(JSON.parse(init.body).requests.map((item: { engine: string; voice: string }) => [item.engine, item.voice])).toEqual([["phonon", req.voice], ["phonon", req.voice]]);
    expect(progress).toHaveBeenLastCalledWith(2, 2, expect.objectContaining({ worker: "Phonon" }));
    // Nothing was generated from the device.
    expect(fetchMock.mock.calls.every(([called]) => String(called).startsWith("/api/preparations"))).toBe(true);
  });

  it("plays the passage the server is preparing instead of asking Phonon for it a second time", async () => {
    const opening = { ...req, text: "The passage being played." };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ id: "job-2", state: "running", done: 0, total: 1 }, { status: 202 })
      : url.endsWith("/audio/0") ? audio() : Response.json({ id: "job-2", state: "done", done: 1, total: 1 }));
    // Opening a reading starts its preparation and playback in the same moment.
    const preparing = prepareInBackground([opening], 0);
    const chunk = await synthesize(opening);
    await preparing;
    expect(chunk.audio).toBeDefined();
    const called = fetchMock.mock.calls.map(([url]) => String(url));
    expect(called).toContain("/api/preparations/job-2/audio/0");
    expect(called.some((url) => url.startsWith("/api/phonon"))).toBe(false);
  });

  it("lists the server's voice names and rejects anything that is not a list", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ aliases: {}, voices: ["Alfie", "default", 7, ""] }));
    expect(await fetchPhononVoices()).toEqual(["Alfie", "default"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/phonon/v1/audio/voices");
    fetchMock.mockResolvedValueOnce(Response.json({ voices: "Alfie" }));
    await expect(fetchPhononVoices()).rejects.toBeInstanceOf(ApiRejected);
  });
});
