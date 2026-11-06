// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPreparationCatalog, type SharedPreparation } from "../engine/preparation";
import { cacheKey } from "../engine/providers";
import { db, docs, type DocRecord } from "../lib/db";
import { planPassages, segment } from "../lib/segment";
import { usePreparation } from "./preparation";

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

vi.mock("../engine/providers", async (original) => ({ ...await original<typeof import("../engine/providers")>(), API_BASE: "/api/vs" }));
vi.mock("../engine/preparation", async (original) => ({ ...await original<typeof import("../engine/preparation")>(), refreshPreparationCatalog: vi.fn(), sharedAudioRemaining: () => 0 }));

const rec: DocRecord = { id: "doc", title: "Shared doc", text: "First passage.\n\nSecond passage.", voice: null, chars: 30, source: "paste", domain: "Text", createdAt: 0, updatedAt: 0 };
const reading = (id: string): SharedPreparation => {
  const keys = planPassages(segment(rec.text).sentences).map((p) => cacheKey({ text: p.text, voice: "expr-voice-2-f", engine: "kittentts" }));
  return { id, state: "done", done: keys.length, total: keys.length, keys, available: keys.map((_, i) => i), voice: "expr-voice-2-f", engine: "kittentts", createdAt: 1 };
};

beforeEach(async () => {
  localStorage.clear();
  usePreparation.setState({ jobs: [], hiddenShared: [] });
  const database = await db();
  await database.clear("docs");
  await docs.put(rec);
});

describe("Shared server preparations", () => {
  it("keeps cleared finished readings hidden across syncs and reloads", async () => {
    vi.mocked(refreshPreparationCatalog).mockResolvedValue([reading("one")]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs.map((j) => j.status)).toEqual(["ready"]);

    usePreparation.getState().dismissFinished();
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

  it("shows new readings and forgets dismissals the server no longer lists", async () => {
    vi.mocked(refreshPreparationCatalog).mockResolvedValue([reading("one")]);
    await usePreparation.getState().refreshShared();
    usePreparation.getState().dismissFinished();

    vi.mocked(refreshPreparationCatalog).mockResolvedValue([{ ...reading("two"), createdAt: 2 }]);
    await usePreparation.getState().refreshShared();
    expect(usePreparation.getState().jobs.map((j) => j.serverId)).toEqual(["two"]);
    expect(usePreparation.getState().hiddenShared).toEqual([]);
  });
});
