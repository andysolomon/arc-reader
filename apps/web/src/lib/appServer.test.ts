import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorHttp } from "@capacitor/core";
import { appApiUrl, serverFetch, setAppServer } from "./appServer";
import { isNativeApp } from "./native";

vi.mock("./native", () => ({ isNativeApp: vi.fn(() => true) }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: { request: vi.fn() } }));
const http = vi.mocked(CapacitorHttp.request);
const result = (data: unknown, type = "application/json", status = 200) => ({ data, headers: { "Content-Type": type }, status, url: "https://reader.example:8449/api/test" });

beforeEach(() => {
  vi.mocked(isNativeApp).mockReturnValue(true);
  setAppServer("https://reader.example:8449");
  http.mockReset().mockResolvedValue(result({ ok: true }));
});
afterEach(() => vi.unstubAllGlobals());

describe("native app server transport", () => {
  it.each(["/api/vs/v1/audio/voices", "/api/oa/v1/audio/speech", "/api/fish/model", "/api/preparations/job/audio/0",
    "/api/llm/config", "/api/jev/v1/systemone", "/api/fetch?url=https%3A%2F%2Fexample.com", "/api/favicon?host=example.com"])("routes %s to the selected server", async (path) => {
    expect(await (await serverFetch(path)).json()).toEqual({ ok: true });
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ url: `https://reader.example:8449${path}` }));
  });

  it("keeps browser fetch, request bodies and streams unchanged", async () => {
    vi.mocked(isNativeApp).mockReturnValue(false);
    const response = new Response("bytes");
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    const init = { method: "POST", body: new FormData(), signal: new AbortController().signal };
    expect(await serverFetch("/api/vs/transcribe", init)).toBe(response);
    expect(fetch).toHaveBeenCalledWith("/api/vs/transcribe", init);
    expect(http).not.toHaveBeenCalled();
  });

  it("does not rewrite assets or unrelated absolute URLs", () => {
    expect(appApiUrl("/icons/icon.svg")).toBe("/icons/icon.svg");
    expect(appApiUrl("https://other.example/article")).toBe("https://other.example/article");
    expect(appApiUrl("//other.example/api/test")).toBe("//other.example/api/test");
  });

  it("keeps generated MP3 bytes intact instead of decoding them as UTF-8", async () => {
    const bytes = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 0x80, 0xfe]);
    http.mockResolvedValue(result(btoa(String.fromCharCode(...bytes)), "audio/mpeg"));
    const response = await serverFetch("/api/oa/v1/audio/speech", { method: "POST", body: JSON.stringify({ input: "Hello" }) });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ responseType: "arraybuffer" }));
  });

  it("preserves raw cached audio uploads and their metadata", async () => {
    await serverFetch("/api/preparations/job/audio/0", { method: "PUT", body: new Blob([Uint8Array.from([255, 0, 128])], { type: "audio/mpeg" }), headers: { "x-duration": "2.5" } });
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ data: "/wCA", dataType: "file", headers: { "content-type": "audio/mpeg", "x-duration": "2.5" } }));
  });

  it("serializes multipart recordings and repeated fields without changing file bytes", async () => {
    const form = new FormData();
    form.append("audio", new File([Uint8Array.from([255, 0, 128])], "voice.mp4", { type: "audio/mp4" }));
    form.append("mode", "fast");
    form.append("tag", "one"); form.append("tag", "two");
    await serverFetch("/api/vs/transcribe", { method: "POST", body: form });
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ dataType: "formData", data: [
      { key: "audio", type: "base64File", value: "/wCA", fileName: "voice.mp4", contentType: "audio/mp4" },
      { key: "mode", type: "string", value: "fast" },
      { key: "tag", type: "string", value: "one" }, { key: "tag", type: "string", value: "two" },
    ] }));
  });

  it("sends a text body even when the caller names no content type", async () => {
    await serverFetch("/api/test", { method: "POST", body: "plain" });
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ data: "plain", headers: { "content-type": "text/plain;charset=UTF-8" } }));
    await serverFetch("/api/test", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(http).toHaveBeenLastCalledWith(expect.objectContaining({ data: "{}", headers: { "content-type": "application/json" } }));
  });

  it("retains JSON errors and empty deletion responses", async () => {
    http.mockResolvedValueOnce(result({ detail: "Choose a voice" }, "application/json", 422));
    const response = await serverFetch("/api/vs/profiles", { method: "POST" });
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ detail: "Choose a voice" });
    http.mockResolvedValueOnce(result("", "text/plain", 204));
    expect((await serverFetch("/api/vs/profiles/id", { method: "DELETE" })).status).toBe(204);
  });

  it("exposes completed task events as a readable response body", async () => {
    const events = 'data: {"type":"progress"}\n\ndata: {"type":"done"}\n\n';
    http.mockResolvedValue(result(btoa(events), "text/event-stream"));
    expect(await (await serverFetch("/api/vs/tasks/stream/id")).text()).toBe(events);
  });

  it("rejects an aborted request before submitting it", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(serverFetch("/api/vs/transcribe", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(http).not.toHaveBeenCalled();
  });

  it("stops waiting promptly and ignores a late native result after cancellation", async () => {
    let finish!: (value: Awaited<ReturnType<typeof CapacitorHttp.request>>) => void;
    http.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const request = serverFetch("/api/vs/transcribe", { signal: controller.signal });
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    finish(result({ text: "Late transcript" }));
  });
});
