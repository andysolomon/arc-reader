import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("localStorage", storage);
  // The settings store reads window.localStorage, which the node test environment lacks.
  vi.stubGlobal("window", { localStorage: storage, innerWidth: 1280 });
});
afterEach(() => vi.unstubAllGlobals());
describe("app server settings migration", () => {
  it("keeps a previously saved library server as the connection for every feature", async () => {
    localStorage.setItem("readaloud:settings", JSON.stringify({ version: 2, state: { libraryServer: "https://existing.example:8449", speechServer: "https://voices.example" } }));
    const { useSettings } = await import("./settings");
    const { appServer } = await import("../lib/appServer");
    expect(useSettings.getState().appServer).toBe("https://existing.example:8449");
    expect(appServer()).toBe("https://existing.example:8449");
    expect(useSettings.getState().speechServer).toBe("https://voices.example");
  });
  it("prefers the saved app server and does not retain the obsolete setting", async () => {
    localStorage.setItem("readaloud:settings", JSON.stringify({ version: 2, state: { libraryServer: "https://old.example", appServer: "https://new.example" } }));
    const { useSettings } = await import("./settings");
    expect(useSettings.getState().appServer).toBe("https://new.example");
    expect(useSettings.getState()).not.toHaveProperty("libraryServer");
  });
});
