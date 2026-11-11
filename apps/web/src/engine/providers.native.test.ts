import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CapacitorHttp } from "@capacitor/core";
import { setAppServer } from "../lib/appServer";
import { setSpeechEndpoint } from "../lib/speechServer";
import { activeApiBase, activeFishBase, activeOpenAIBase, usesBuiltInProxy, openaiSpeechSynthesize, fishSynthesize } from "./providers";
import { useVoices } from "../state/voices";
import { studioUrl } from "../lib/studio";

vi.mock("../lib/native", () => ({ isNativeApp: () => true }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: { request: vi.fn() } }));
vi.mock("./audio", () => ({ measureDuration: async () => 2 }));
const http = vi.mocked(CapacitorHttp.request);

beforeEach(() => {
  setAppServer("https://reader.example:8449");
  setSpeechEndpoint({ override: "", key: "" });
  http.mockReset().mockImplementation(async ({ url }) => {
    const data = url.endsWith("/v1/audio/voices") ? { voices: [{ id: "clone-1", name: "My clone", type: "profile" }], engines: [{ id: "omnivoice", available: true, supports_cloning: true }] }
      : url.endsWith("/profiles") ? [{ id: "clone-1", name: "My clone", kind: "clone" }]
      : url.endsWith("/engines") ? { tts: { active: "omnivoice" } }
      : { items: [{ _id: "fish-custom", title: "Fish catalogue voice" }] };
    return { data, status: 200, headers: { "content-type": "application/json" }, url };
  });
});
afterEach(() => setSpeechEndpoint({ override: "", key: "" }));

describe("native full-server connection", () => {
  it("enables every provider and prepared audio through the website", () => {
    expect(activeApiBase()).toBe("https://reader.example:8449/api/vs");
    expect(activeOpenAIBase()).toBe("https://reader.example:8449/api/oa");
    expect(activeFishBase()).toBe("https://reader.example:8449/api/fish");
    expect(usesBuiltInProxy()).toBe(true);
    expect(studioUrl("/dub/media/id")).toBe("https://reader.example:8449/api/vs/dub/media/id");
  });

  it("loads saved profiles, OpenAI voices and Fish voices together", async () => {
    await useVoices.getState().load();
    const voices = useVoices.getState().voices;
    expect(voices).toContainEqual(expect.objectContaining({ id: "clone-1", engine: "omnivoice", kind: "profile" }));
    expect(voices.some((v) => v.engine === "openai")).toBe(true);
    expect(voices).toContainEqual(expect.objectContaining({ id: "fish:fish-custom", engine: "fish" }));
    expect(voices.some((v) => v.id === "local")).toBe(true);
    expect(http.mock.calls.every(([options]) => options.url.startsWith("https://reader.example:8449/api/"))).toBe(true);
  });

  it("retains a direct VoiceStudio override without sending its key to paid providers", async () => {
    setSpeechEndpoint({ override: "https://voices.example", key: "studio-secret" });
    expect(activeApiBase()).toBe("https://voices.example");
    expect(usesBuiltInProxy()).toBe(false);
    http.mockImplementation(async ({ url }) => ({ url, status: 200, data: btoa("audio"), headers: { "content-type": "audio/mpeg" } }));
    await openaiSpeechSynthesize({ text: "Hello.", voice: "alloy", engine: "openai" });
    await fishSynthesize({ text: "Hello.", voice: "fish:custom", engine: "fish" });
    for (const [options] of http.mock.calls) {
      expect(options.url).toMatch(/reader\.example:8449\/api\/(oa|fish)\//);
      expect(options.headers?.authorization).toBeUndefined();
    }
  });

  it("offers all server providers even when the iOS build has no web provider environment variables", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE", ""); vi.stubEnv("VITE_OPENAI_BASE", ""); vi.stubEnv("VITE_FISH_BASE", "");
    try {
      const connection = await import("../lib/appServer");
      connection.setAppServer("https://app.example");
      const providers = await import("./providers");
      expect(providers.activeApiBase()).toBe("https://app.example/api/vs");
      expect(providers.activeOpenAIBase()).toBe("https://app.example/api/oa");
      expect(providers.activeFishBase()).toBe("https://app.example/api/fish");
    } finally { vi.unstubAllEnvs(); }
  });
});
