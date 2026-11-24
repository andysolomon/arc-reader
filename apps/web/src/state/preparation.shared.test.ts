// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedPreparation } from "../engine/preparation";
import { cacheKey } from "../engine/providers";
import { db, docs, type DocRecord } from "../lib/db";
import { planPassages, segment } from "../lib/segment";
import { READY_LINGER_MS, usePreparation } from "./preparation";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const local = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: local, configurable: true });
  vi.stubGlobal("localStorage", local);
});

/** What the web server lists at /api/preparations, the catalogue every device syncs. */
let listed: SharedPreparation[] = [];
const serverLists = (jobs: SharedPreparation[]) => { listed = jobs; };

const rec: DocRecord = { id: "doc", title: "Shared doc", text: "First passage.\n\nSecond passage.", voice: null, chars: 30, source: "paste", domain: "Text", createdAt: 0, updatedAt: 0 };
const reading = (id: string, state: SharedPreparation["state"] = "done"): SharedPreparation => {
  const keys = planPassages(segment(rec.text).sentences).map((p) => cacheKey({ text: p.text, voice: "expr-voice-2-f", engine: "kittentts" }));
  return { id, state, done: state === "running" ? 0 : keys.length, total: keys.length, keys, available: keys.map((_, i) => i), voice: "expr-voice-2-f", engine: "kittentts", createdAt: 1 };
};

beforeEach(async () => {
  listed = [];
  vi.stubGlobal("fetch", async (url: string) => url === "/api/preparations" ? Response.json({ jobs: listed }) : new Response(null, { status: 404 }));
  localStorage.clear();
  usePreparation.setState({ jobs: [], hiddenShared: [] });
  const database = await db();
  await database.clear("docs");
  await docs.put(rec);
});
afterEach(() => { vi.useRealTimers(); });

describe("Shared server preparations", () => {
  it("does not list readings that finished before this device was watching", async () => {
    serverLists([reading("one")]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs).toEqual([]);
  });

  it("shows a reading finishing, then clears it and keeps it hidden across syncs and reloads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serverLists([reading("one", "running")]);
    await usePreparation.getState().refreshShared();
    serverLists([reading("one")]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs.map((j) => j.status)).toEqual(["ready"]);

    vi.advanceTimersByTime(READY_LINGER_MS);
    expect(usePreparation.getState().jobs).toEqual([]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs).toEqual([]);

    // A reload drops in-memory state; the dismissal must come back from storage.
    const saved = localStorage.getItem("readaloud:preparation-queue")!;
    usePreparation.setState({ jobs: [], hiddenShared: [] });
    localStorage.setItem("readaloud:preparation-queue", saved);
    await usePreparation.persist.rehydrate();
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs).toEqual([]);
  });

  it("keeps failed readings until cleared", async () => {
    serverLists([{ ...reading("one", "error"), error: "Server refused" }]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs.map((j) => j.status)).toEqual(["error"]);
    usePreparation.getState().dismissFinished();
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs).toEqual([]);
  });

  it("shows new readings and forgets dismissals the server no longer lists", async () => {
    serverLists([reading("one", "error")]);
    await usePreparation.getState().refreshShared();
    usePreparation.getState().dismissFinished();

    serverLists([{ ...reading("two", "running"), createdAt: 2 }]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs.map((j) => j.serverId)).toEqual(["two"]);
    expect(usePreparation.getState().hiddenShared).toEqual([]);
  });
});
