import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreparationWorkers } from "./vite.preparation-workers";
import type { PreparationRequest } from "./src/engine/preparation";

const request: PreparationRequest = { key: "voice|text", text: "Hello.", voice: "saved", engine: "omnivoice", profile: true, protocol: "openai" };
const design = { id: "saved", kind: "design", language: "English", instruct: "calm", seed: 42, vd_states: "{}" };
const env = { VOICESTUDIO_URL: "https://mac.test", VOICESTUDIO_API_KEY: "mac-key", VOICESTUDIO_SECONDARY_URL: "http://omarchy.test", VOICESTUDIO_SECONDARY_API_KEY: "cpu-key" };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("preparation machine compatibility", () => {
  let primary: typeof design[], secondary: typeof design[], active: string, cloning: boolean, reference: string;
  beforeEach(() => {
    primary = [{ ...design }]; secondary = [{ ...design }]; active = "omnivoice"; cloning = true; reference = "same audio";
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const cpu = url.startsWith("http://omarchy.test");
      expect(options.headers).toEqual({ Authorization: `Bearer ${cpu ? "cpu-key" : "mac-key"}` });
      if (url.endsWith("/engines")) return json({ tts: { active, backends: [{ id: "omnivoice", available: true, supports_cloning: cloning }] } });
      if (url.endsWith("/profiles")) return json(cpu ? secondary : primary);
      if (url.endsWith("/audio")) return new Response(cpu ? reference : "same audio");
      return new Response(null, { status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("accepts a matching saved design without transferring a recipe or reference", async () => {
    const workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request, request])).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("leaves missing or changed voice recipes on the primary machine", async () => {
    secondary = [];
    let workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(false);
    secondary = [{ ...design, seed: 43 }];
    workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(false);
  });

  it("checks the selected engine and cloning capability before routing saved voices", async () => {
    active = "kittentts";
    let workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(false);
    active = "omnivoice"; cloning = false;
    workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(false);
  });

  it("requires identical clone reference audio on both machines", async () => {
    primary = [{ ...design, kind: "clone" }]; secondary = [{ ...design, kind: "clone" }];
    let workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(true);
    reference = "a different speaker";
    workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(false);
  });

  it("uses only the primary when secondary discovery fails or both URLs are identical", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Offline"));
    const workers = new PreparationWorkers(env);
    expect(await workers.supports(workers.workers[1], [request])).toBe(false);
    expect(await workers.supports(workers.workers[0], [request])).toBe(true);
    expect(new PreparationWorkers({ ...env, VOICESTUDIO_SECONDARY_URL: `${env.VOICESTUDIO_URL}/` }).workers).toHaveLength(1);
  });
});
