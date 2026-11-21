import { afterEach, expect, it, vi } from "vitest";
import { audioNoticeMessage, deviceStorage, formatBytes, keepStorage } from "./storage";

afterEach(() => { vi.unstubAllGlobals(); });

it("formats sizes in the unit people expect", () => {
  expect(formatBytes(0)).toBe("0 MB");
  expect(formatBytes(500)).toBe("Under 1 KB");
  expect(formatBytes(68 * 1024)).toBe("68 KB");
  expect(formatBytes(148.4 * 1024 ** 2)).toBe("148 MB");
  expect(formatBytes(1023.8 * 1024 ** 2)).toBe("1 GB");
  expect(formatBytes(1024 ** 3)).toBe("1 GB");
  expect(formatBytes(1.24 * 1024 ** 3)).toBe("1.2 GB");
  expect(formatBytes(18.6 * 1024 ** 3)).toBe("19 GB");
});

it("reports only what the browser can tell it", async () => {
  vi.stubGlobal("navigator", {});
  expect(await deviceStorage()).toEqual({});
  vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => false } });
  expect(await deviceStorage()).toEqual({ used: 10, allowed: 100, kept: false });
  vi.stubGlobal("navigator", { storage: { estimate: async () => { throw new Error("blocked"); } } });
  expect(await deviceStorage()).toEqual({});
});

it("asks the browser to keep storage only when it is not kept already", async () => {
  const persist = vi.fn(async () => true);
  vi.stubGlobal("navigator", { storage: { persisted: async () => true, persist } });
  expect(await keepStorage()).toBe(true);
  expect(persist).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist } });
  expect(await keepStorage()).toBe(true);
  expect(persist).toHaveBeenCalledOnce();
  vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist: async () => false } });
  expect(await keepStorage()).toBe(false);
  vi.stubGlobal("navigator", {});
  expect(await keepStorage()).toBe(false);
});

it("words the notices for people", () => {
  expect(audioNoticeMessage({ kind: "trimmed", clips: 1, limit: 1024 ** 3 })).toBe("Removed 1 older audio clip to stay under 1 GB");
  expect(audioNoticeMessage({ kind: "trimmed", clips: 1240, limit: 150 * 1024 ** 2 })).toBe(`Removed ${(1240).toLocaleString()} older audio clips to stay under 150 MB`);
  expect(audioNoticeMessage({ kind: "full" })).toMatch(/out of space/);
});
