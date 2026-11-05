import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProxyOptions } from "vite";
import { voiceStudioProxy } from "./vite.proxy";
import { SpeechActivity } from "./vite.speech-activity";

const path = "^/api/fish(?:/|$)";
describe("VoiceStudio proxy", () => {
  function configure(activity?: SpeechActivity) {
    const proxy = voiceStudioProxy({ VOICESTUDIO_URL: "http://mac:3900/", VOICESTUDIO_API_KEY: "k" }, activity)["/api/vs"];
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    proxy.configure!({ on: vi.fn((name, handler) => { handlers[name] = handler; }) } as unknown as Parameters<NonNullable<ProxyOptions["configure"]>>[0], proxy);
    return handlers;
  }
  const proxyReq = () => ({ setHeader: vi.fn(), removeHeader: vi.fn() });
  const res = () => { const listeners: Record<string, () => void> = {}; return { once: vi.fn((name: string, fn: () => void) => { listeners[name] = fn; }), listeners }; };

  it("marks a live speech request on its server until the response closes", () => {
    const activity = new SpeechActivity(1000);
    const handlers = configure(activity);
    const response = res();
    handlers.proxyReq(proxyReq(), { method: "POST", url: "/v1/audio/speech" }, response);
    expect(activity.pending("http://mac:3900")).toBe(Infinity);
    response.listeners.close();
    expect(activity.pending("http://mac:3900")).toBeGreaterThan(0);
  });

  it("ignores other VoiceStudio traffic and works without an activity tracker", () => {
    const activity = new SpeechActivity(1000);
    const handlers = configure(activity);
    const response = res();
    handlers.proxyReq(proxyReq(), { method: "GET", url: "/engines" }, response);
    handlers.proxyReq(proxyReq(), { method: "POST", url: "/v1/audio/transcriptions" }, response);
    expect(activity.pending("http://mac:3900")).toBe(0);
    expect(response.once).not.toHaveBeenCalled();
    const bare = proxyReq();
    expect(() => configure().proxyReq(bare, { method: "POST", url: "/v1/audio/speech" }, res())).not.toThrow();
    expect(bare.setHeader).toHaveBeenCalledWith("authorization", "Bearer k");
  });
});

describe("Fish proxy", () => {
  it("requires a server-side key", () => {
    expect(voiceStudioProxy({})[path]).toBeUndefined();
  });
  it("injects the server credential and strips browser credentials", () => {
    const proxy = voiceStudioProxy({ FISH_API_KEY: "test-secret" })[path];
    expect(proxy.target).toBe("https://api.fish.audio");
    expect(proxy.rewrite?.("/api/fish/v1/tts")).toBe("/v1/tts");
    const handlers: Record<string, (req: unknown) => void> = {};
    const server = { on: vi.fn((name, handler) => { handlers[name] = handler; }) };
    proxy.configure!(server as unknown as Parameters<NonNullable<ProxyOptions["configure"]>>[0], proxy);
    const req = { setHeader: vi.fn(), removeHeader: vi.fn() };
    handlers.proxyReq(req);
    expect(req.setHeader).toHaveBeenCalledWith("authorization", "Bearer test-secret");
    expect(req.removeHeader).toHaveBeenCalledWith("cookie");
    expect(req.removeHeader).toHaveBeenCalledWith("origin");
  });
  it.each([
    ["GET", "/api/fish/model?page_size=12", true],
    ["GET", "/api/fish/model/voice-id", true],
    ["POST", "/api/fish/v1/tts", true],
    ["DELETE", "/api/fish/model/voice-id", false],
    ["POST", "/api/fish/model", false],
    ["GET", "/api/fish/wallet", false],
  ])("allows only supported endpoints: %s %s", (method, url, allowed) => {
    const proxy = voiceStudioProxy({ FISH_API_KEY: "test-secret" })[path];
    const res = { end: vi.fn(), statusCode: 200 };
    const result = proxy.bypass!({ method, url } as IncomingMessage, res as unknown as ServerResponse, proxy);
    expect(result).toBe(allowed ? undefined : false);
  });
});
