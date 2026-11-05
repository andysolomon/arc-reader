import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasActivePreparation, prepareAudio, preparedAudio, type PreparationRequest } from "./preparation";

const requests: PreparationRequest[] = ["first", "second"].map((text) => ({ key: text, text, engine: "kittentts", voice: "v", protocol: "openai" }));
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const status = (state: string, done: number) => ({ id: "job-id", state, done, total: 2 });
const fetchMock = vi.fn();

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("background preparation client", () => {
  it("retries submission while the web server restarts", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError("Connection refused"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(response(status("running", 1)))
      .mockResolvedValueOnce(response(status("done", 2)));
    const run = prepareAudio(requests, 0);
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
    expect(hasActivePreparation(requests)).toBe(false);
  });

  it("can cancel while waiting for the web server to return", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError("Connection refused"));
    const controller = new AbortController();
    const run = prepareAudio(requests, 0, undefined, controller.signal);
    const rejection = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("submits all passages once, reconnects after reload, and retrieves stored audio", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(response(status("running", 0)))
      .mockResolvedValueOnce(response(status("running", 1)))
      .mockResolvedValueOnce(response(status("done", 2)));
    const progress = vi.fn();
    const run = prepareAudio(requests, 1, progress);
    await vi.advanceTimersByTimeAsync(1500);
    await run;
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ requests, start: 1 });
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    vi.resetModules();
    const reloaded = await import("./preparation");
    expect(reloaded.hasActivePreparation(requests)).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("audio", { headers: { "content-type": "audio/mpeg" } }));
    expect(await (await reloaded.preparedAudio("second"))?.text()).toBe("audio");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/preparations/job-id/audio/1");
  });

  it("reattaches to a running job without submitting it again and retries a lost connection", async () => {
    vi.useFakeTimers();
    localStorage.setItem("readaloud:preparations", JSON.stringify([{ id: "saved-id", signature: "unused", keys: ["first", "second"], active: true }]));
    fetchMock.mockResolvedValueOnce(response(status("running", 0)))
      .mockRejectedValueOnce(new TypeError("Network disconnected"))
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(response(status("done", 2)));
    const run = prepareAudio(requests, 0);
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    // Simulate a job left active when a page was closed.
    const entries = JSON.parse(localStorage.getItem("readaloud:preparations")!);
    entries.at(-1).active = true;
    localStorage.setItem("readaloud:preparations", JSON.stringify(entries));
    expect(hasActivePreparation(requests)).toBe(true);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(response(status("done", 2)));
    await prepareAudio(requests.map((r) => ({ ...r, cached: true })), 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/preparations/job-id");
  });

  it("cancels even when the user aborts before submission returns its job id", async () => {
    let submitted!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { submitted = resolve; }))
      .mockResolvedValue(response(status("cancelled", 0)));
    const controller = new AbortController();
    const run = prepareAudio(requests, 0, undefined, controller.signal);
    const rejection = expect(run).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    submitted(response(status("running", 0)));
    await rejection;
    expect(fetchMock.mock.calls.at(-1)).toEqual(["/api/preparations/job-id", { method: "DELETE", keepalive: true }]);
    expect(hasActivePreparation(requests)).toBe(false);
  });

  it("surfaces job errors and permits regeneration after stored audio expires", async () => {
    fetchMock.mockResolvedValueOnce(response(status("running", 0)))
      .mockResolvedValueOnce(response({ ...status("error", 0), error: "Model terms need acceptance" }));
    await expect(prepareAudio(requests, 0)).rejects.toThrow("Model terms");
    expect(hasActivePreparation(requests)).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await preparedAudio("first")).toBeNull();
  });
});
