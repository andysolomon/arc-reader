import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";

// The browser allows this site 2000 bytes, so downloaded audio may take 1000.
vi.mock("./storage", async (original) => ({ ...(await original<typeof import("./storage")>()), deviceStorage: async () => ({ allowed: 2000 }) }));

import { audioCache, audioLimitFor, db, AUDIO_CACHE_BYTES, type AudioNotice, type AudioRecord } from "./db";

const clip = (key: string, bytes: number, createdAt: number): AudioRecord =>
  ({ key, blob: new Blob([new Uint8Array(bytes)]), mime: "audio/mpeg", duration: 1, createdAt });

beforeEach(async () => { await audioCache.clear(); });

it("measures the audio it holds, including clips saved before sizes were recorded", async () => {
  await audioCache.put(clip("new", 300, 2));
  await (await db()).put("audio", { key: "old", blob: new Blob([new Uint8Array(200)]), mime: "audio/mpeg", duration: 1, createdAt: 1 });
  expect(await audioCache.usage()).toEqual({ clips: 2, bytes: 500 });
  expect((await audioCache.get("new"))?.bytes).toBe(300);
});

it("removes the oldest clips once the audio outgrows its limit, and says so", async () => {
  const notices: AudioNotice[] = [];
  const stop = audioCache.onNotice((notice) => notices.push(notice));
  // Saved out of order: age is when a clip was made, not when it arrived.
  for (const [key, createdAt] of [["b", 2], ["a", 1], ["c", 3]] as const) await audioCache.put(clip(key, 300, createdAt));
  expect(await audioCache.usage()).toEqual({ clips: 3, bytes: 900 });
  expect(notices).toEqual([]);

  await audioCache.put(clip("d", 300, 4));
  expect(await audioCache.usage()).toEqual({ clips: 3, bytes: 900 });
  expect((await audioCache.keys()).sort()).toEqual(["b", "c", "d"]);
  expect(notices).toEqual([{ kind: "trimmed", clips: 1, limit: 1000 }]);
  stop();
});

it("makes room in one pass when a visit starts over the limit", async () => {
  const d = await db();
  for (let i = 1; i <= 6; i++) await d.put("audio", clip(`k${i}`, 300, i));
  // A new visit: nothing is known about what earlier visits and other tabs saved.
  vi.resetModules();
  const visit = (await import("./db")).audioCache;
  const notices: AudioNotice[] = [];
  visit.onNotice((notice) => notices.push(notice));
  await visit.put(clip("k7", 300, 7));
  // 2100 bytes against a limit of 1000: trimmed to 900, leaving room for the next clips.
  expect(await visit.usage()).toEqual({ clips: 3, bytes: 900 });
  expect((await visit.keys()).sort()).toEqual(["k5", "k6", "k7"]);
  expect(notices).toEqual([{ kind: "trimmed", clips: 4, limit: 1000 }]);
});

it("notices audio another tab saved, after enough saves of its own", async () => {
  const d = await db();
  await audioCache.put(clip("mine", 1, 1));
  await audioCache.usage();
  // Another tab fills the store; this tab's own saves stay far below the limit.
  for (let i = 0; i < 4; i++) await d.put("audio", clip(`theirs${i}`, 300, 2 + i));
  for (let i = 0; i < 200; i++) await audioCache.put(clip(`mine${i}`, 1, 10 + i));
  const { bytes } = await audioCache.usage();
  expect(bytes).toBeLessThanOrEqual(1000);
  expect(await audioCache.get("theirs0")).toBeUndefined();
});

it("says once when the device refuses a save, and again only after audio is removed", async () => {
  const notices: AudioNotice[] = [];
  const stop = audioCache.onNotice((notice) => notices.push(notice));
  const d = await db();
  const full = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  const put = vi.spyOn(d, "put").mockRejectedValue(full);
  await expect(audioCache.put(clip("a", 10, 1))).rejects.toBe(full);
  await expect(audioCache.put(clip("b", 10, 2))).rejects.toBe(full);
  expect(notices).toEqual([{ kind: "full" }]);
  await audioCache.clear();
  await expect(audioCache.put(clip("c", 10, 3))).rejects.toBe(full);
  expect(notices).toEqual([{ kind: "full" }, { kind: "full" }]);
  put.mockRestore();
  stop();
});

it("limits audio to 1 GB, or to half of what the browser allows when that is less", () => {
  expect(audioLimitFor()).toBe(AUDIO_CACHE_BYTES);
  expect(audioLimitFor(100 * 1024 ** 3)).toBe(AUDIO_CACHE_BYTES);
  expect(audioLimitFor(300 * 1024 ** 2)).toBe(150 * 1024 ** 2);
});
