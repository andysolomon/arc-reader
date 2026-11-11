import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { entryScript, reloadWhenIdle, serverHasNewBuild, serverReachable } from "./appUpdate";

const store = (playing: boolean) => create(() => ({ playing, loading: false, preparing: null as string | null }));

describe("reloadWhenIdle", () => {
  it("reloads at once when nothing is playing", () => {
    const reload = vi.fn();
    reloadWhenIdle(store(false), reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits until playback, loading, and preparation have all stopped", () => {
    const s = store(true);
    const reload = vi.fn();
    reloadWhenIdle(s, reload);
    // Between passages the engine keeps `playing` and may wait on the next clip.
    s.setState({ loading: true });
    s.setState({ loading: false, preparing: "Preparing image and diagram descriptions…" });
    s.setState({ preparing: null });
    expect(reload).not.toHaveBeenCalled();
    s.setState({ playing: false });
    s.setState({ playing: true });
    s.setState({ playing: false });
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("serverHasNewBuild", () => {
  const page = (script: string) => `<!doctype html><head><link rel="modulepreload" href="/assets/vendor-1.js"><script type="module" crossorigin src="${script}"></script></head>`;

  it("reads the entry script whether the page is the file or the parsed document", () => {
    expect(entryScript(page("/assets/index-aaa.js"))).toBe("/assets/index-aaa.js");
    expect(entryScript('<script type="module" crossorigin="" src="/assets/index-aaa.js"></script>')).toBe("/assets/index-aaa.js");
    expect(entryScript("<h1>502 Bad Gateway</h1>")).toBeNull();
  });

  it("is true only when the server serves another build", async () => {
    expect(await serverHasNewBuild("/assets/index-aaa.js", async () => page("/assets/index-bbb.js"))).toBe(true);
    expect(await serverHasNewBuild("/assets/index-aaa.js", async () => page("/assets/index-aaa.js"))).toBe(false);
  });

  it("stays put when the server is unreachable or mid-deploy", async () => {
    expect(await serverHasNewBuild("/assets/index-aaa.js", async () => { throw new TypeError("Load failed"); })).toBe(false);
    expect(await serverHasNewBuild("/assets/index-aaa.js", async () => "<h1>502 Bad Gateway</h1>")).toBe(false);
    expect(await serverHasNewBuild(null, async () => page("/assets/index-bbb.js"))).toBe(false);
  });
});

describe("serverReachable", () => {
  it("is true when the server answers", async () => {
    expect(await serverReachable(1000, async () => new Response("ok"))).toBe(true);
  });

  it("is false on an error status, a network failure, or no answer in time", async () => {
    expect(await serverReachable(1000, async () => new Response("", { status: 502 }))).toBe(false);
    expect(await serverReachable(1000, async () => { throw new TypeError("Load failed"); })).toBe(false);
    const hang: typeof fetch = (_url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    expect(await serverReachable(20, hang)).toBe(false);
  });
});
