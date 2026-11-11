import { describe, expect, it, afterEach } from "vitest";
import { normalizeSpeechServer, resolveApiBase, setSpeechEndpoint, speechEndpoint, withSpeechAuth } from "./speechServer";

afterEach(() => setSpeechEndpoint({ override: "", key: "" }));

describe("speech server address", () => {
  it("keeps absolute http(s) URLs and drops a trailing slash", () => {
    expect(normalizeSpeechServer(" https://mac.tailnet.ts.net:3900/ ")).toBe("https://mac.tailnet.ts.net:3900");
    expect(normalizeSpeechServer("https://host.ts.net:8449/api/vs/")).toBe("https://host.ts.net:8449/api/vs");
  });

  it("rejects relative paths, localhost-only schemes, and empty text", () => {
    expect(normalizeSpeechServer("")).toBe("");
    expect(normalizeSpeechServer("/api/vs")).toBe("");
    expect(normalizeSpeechServer("localhost:3900")).toBe("");
    expect(normalizeSpeechServer("file:///tmp/voices")).toBe("");
  });

  it("uses the build-time base on the web, and ignores a relative proxy in the iOS shell", () => {
    expect(resolveApiBase("/api/vs", false)).toBe("/api/vs");
    expect(resolveApiBase("/api/vs", true)).toBe("");
    expect(resolveApiBase("https://voices.example/v1", true)).toBe("https://voices.example/v1");
  });

  it("lets a saved absolute server replace the baked-in base", () => {
    expect(resolveApiBase("/api/vs", true, "https://mac.tailnet.ts.net:3900/")).toBe("https://mac.tailnet.ts.net:3900");
    expect(resolveApiBase("/api/vs", false, "not a url")).toBe("/api/vs");
  });

  it("sends the key only to the configured speech server", () => {
    setSpeechEndpoint({ override: "https://mac.tailnet.ts.net:3900", key: "secret" });
    expect(speechEndpoint().key).toBe("secret");
    expect(withSpeechAuth("/api/vs/v1/audio/speech", { method: "POST" }).headers).toBeUndefined();
    const authed = withSpeechAuth("https://mac.tailnet.ts.net:3900/v1/audio/speech", { method: "POST" });
    expect(new Headers(authed.headers).get("Authorization")).toBe("Bearer secret");
    expect(withSpeechAuth("https://reader.example/api/oa/v1/audio/speech").headers).toBeUndefined();
    expect(withSpeechAuth("https://reader.example/api/fish/v1/tts").headers).toBeUndefined();
    expect(withSpeechAuth("https://mac.tailnet.ts.net:3900.evil.example/v1/audio/speech").headers).toBeUndefined();
    setSpeechEndpoint({ override: "https://reader.example/api/vs", key: "secret" });
    expect(withSpeechAuth("https://reader.example/api/llm/config").headers).toBeUndefined();
    expect(withSpeechAuth("https://reader.example/api/vs-other").headers).toBeUndefined();
  });
});
