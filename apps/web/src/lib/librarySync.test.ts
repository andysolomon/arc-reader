import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, docs, positions, type DocRecord, type PositionRecord } from "./db";
import { syncLibrary, useLibrarySync } from "./librarySync";
import { LibraryService } from "../../vite.library";

const doc = (id: string, updatedAt = 1): DocRecord => ({ id, title: id, text: "Hello.", source: "paste", domain: "Pasted text", voice: null, chars: 6, createdAt: 1, updatedAt });
const position = (docId: string, updatedAt = 1): PositionRecord => ({ docId, index: 1, offset: 0, fraction: 0.5, total: 2, updatedAt });

describe("offline library synchronization", () => {
  let directory: string, service: LibraryService;
  const network = vi.fn<typeof fetch>();
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "readaloud-sync-"));
    service = new LibraryService(directory);
    const d = await db();
    await Promise.all([d.clear("docs"), d.clear("positions"), d.clear("outbox"), d.clear("meta"), d.clear("audio")]);
    network.mockReset();
    network.mockImplementation(async (_url, options) => Response.json(await service.sync(JSON.parse(options!.body as string))));
    vi.stubGlobal("fetch", network);
  });
  afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

  it("imports existing browser libraries and progress once, merges server records, and keeps audio local", async () => {
    const d = await db();
    await d.put("docs", doc("legacy"));
    await d.put("positions", position("legacy"));
    await d.put("audio", { key: "audio", blob: new Blob(["audio"]), mime: "audio/mpeg", duration: 1, createdAt: 1 });
    await service.sync({ changes: [{ kind: "doc", record: doc("remote") }] });
    expect(await syncLibrary()).toBe(true);
    expect((await docs.all()).map((r) => r.id).sort()).toEqual(["legacy", "remote"]);
    expect((await service.sync({ changes: [] })).positions[0].docId).toBe("legacy");
    expect(await d.count("audio")).toBe(1);
    await syncLibrary();
    expect(JSON.parse(network.mock.calls[1][1]!.body as string).changes).toEqual([]);
  });

  it("retains offline writes and deletes across reloads, then drains them on reconnect", async () => {
    await docs.put(doc("a"));
    network.mockRejectedValueOnce(new Error("offline"));
    expect(await syncLibrary()).toBe(false);
    expect(useLibrarySync.getState()).toMatchObject({ status: "offline", pending: 1 });
    await expect((await db()).count("outbox")).resolves.toBe(1);
    expect(await syncLibrary()).toBe(true);
    await positions.put(position("a"));
    await syncLibrary();
    expect((await service.sync({ changes: [] })).positions).toHaveLength(1);
    await docs.delete("a");
    network.mockRejectedValueOnce(new Error("offline"));
    await syncLibrary();
    expect(await docs.get("a")).toBeUndefined();
    // Resetting module state is unnecessary: the pending deletion is durably stored, not in memory.
    expect((await (await db()).getAll("outbox"))[0].change.kind).toBe("delete");
    await syncLibrary();
    expect(await service.sync({ changes: [] })).toEqual({ docs: [], positions: [], deleted: ["a"] });
  });

  it("pulls other clients' edits, progress and deletions without echoing them as new writes", async () => {
    await syncLibrary();
    await service.sync({ changes: [{ kind: "doc", record: doc("other") }, { kind: "position", record: position("other") }] });
    await syncLibrary();
    expect((await docs.get("other"))?.title).toBe("other");
    expect((await positions.get("other"))?.fraction).toBe(0.5);
    expect(await (await db()).count("outbox")).toBe(0);
    await service.sync({ changes: [{ kind: "delete", docId: "other" }] });
    await syncLibrary();
    expect(await docs.get("other")).toBeUndefined();
    expect(await positions.get("other")).toBeUndefined();
  });

  it("preserves newer writes made while the server response is in flight", async () => {
    await docs.put(doc("a"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let received!: () => void;
    const receiving = new Promise<void>((resolve) => { received = resolve; });
    network.mockImplementationOnce(async (_url, options) => {
      const snapshot = await service.sync(JSON.parse(options!.body as string));
      received();
      await gate;
      return Response.json(snapshot);
    });
    const syncing = syncLibrary();
    await receiving;
    await docs.put({ ...doc("a", Date.now() + 1), title: "New title" });
    release();
    await syncing;
    expect((await docs.get("a"))?.title).toBe("New title");
    expect(await (await db()).count("outbox")).toBe(1);
    await syncLibrary();
    expect((await service.sync({ changes: [] })).docs[0].title).toBe("New title");
  });

  it("does not resurrect a deleted document when an offline client imports or edits it", async () => {
    await service.sync({ changes: [{ kind: "delete", docId: "a" }] });
    await docs.put(doc("a"));
    await positions.put(position("a"));
    await syncLibrary();
    expect(await docs.get("a")).toBeUndefined();
    expect(await positions.get("a")).toBeUndefined();
    expect(await (await db()).count("outbox")).toBe(0);
  });

  it("retains the queue when the server refuses a write", async () => {
    await docs.put(doc("a"));
    network.mockResolvedValueOnce(Response.json({ error: "Disk unavailable" }, { status: 500 }));
    expect(await syncLibrary()).toBe(false);
    expect(useLibrarySync.getState()).toMatchObject({ status: "offline", pending: 1, error: "Disk unavailable" });
    expect((await docs.get("a"))?.id).toBe("a");
    expect(await syncLibrary()).toBe(true);
  });
});
