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
    network.mockImplementation(async (url, options) => Response.json(await service.request(String(url).replace("/api/library", ""), JSON.parse(options!.body as string))));
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
    network.mockClear();
    await syncLibrary();
    // Nothing changed: one small request, no document bodies.
    expect(network).toHaveBeenCalledTimes(1);
    expect(JSON.parse(network.mock.calls[0][1]!.body as string)).toEqual({ changes: [], view: "manifest" });
  });

  it("downloads only documents it lacks or holds an older version of, keeping each piece as it arrives", async () => {
    const big = (id: string, updatedAt = 1) => ({ ...doc(id, updatedAt), text: "x".repeat(600_000), chars: 600_000 });
    await service.sync({ changes: [{ kind: "doc", record: big("one") }, { kind: "doc", record: big("two") }, { kind: "doc", record: doc("three") }] });
    // The second piece is lost, as on a tunnel that drops partway.
    let docsRequests = 0;
    network.mockImplementation(async (url, options) => {
      const path = String(url).replace("/api/library", "");
      if (path === "/docs" && ++docsRequests === 2) throw new TypeError("Load failed");
      return Response.json(await service.request(path, JSON.parse(options!.body as string)));
    });
    expect(await syncLibrary()).toBe(false);
    expect((await docs.all()).map((r) => r.id).sort()).toEqual(["one", "three"]);
    network.mockClear();
    expect(await syncLibrary()).toBe(true);
    const asked = network.mock.calls.filter(([url]) => String(url).endsWith("/docs")).map(([, init]) => JSON.parse(init!.body as string).ids);
    expect(asked).toEqual([["two"]]);
    expect((await docs.all()).map((r) => r.id).sort()).toEqual(["one", "three", "two"]);
    // Another device edits one document: only that one comes down.
    await service.sync({ changes: [{ kind: "doc", record: { ...doc("three", 5), title: "Renamed" } }] });
    network.mockClear();
    await syncLibrary();
    expect(network.mock.calls.filter(([url]) => String(url).endsWith("/docs")).map(([, init]) => JSON.parse(init!.body as string).ids)).toEqual([["three"]]);
    expect((await docs.get("three"))?.title).toBe("Renamed");
  });

  it("takes the server's copy when the server refused this device's older edit", async () => {
    await service.sync({ changes: [{ kind: "doc", record: { ...doc("a", 100), title: "Server" } }] });
    // A device whose clock runs behind edits its copy with an earlier time.
    const d = await db();
    await d.put("meta", true, "shared-library-imported");
    await d.put("docs", { ...doc("a", 50), title: "Behind" });
    await d.put("outbox", { key: "doc:a", token: "t", change: { kind: "doc", record: { ...doc("a", 50), title: "Behind" } } });
    expect(await syncLibrary()).toBe(true);
    expect((await docs.get("a"))?.title).toBe("Server");
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
    // The immediate follow-up upload also has to survive losing the connection.
    network.mockRejectedValueOnce(new Error("offline"));
    const syncing = syncLibrary();
    await receiving;
    await docs.put({ ...doc("a", Date.now() + 1), title: "New title" });
    release();
    expect(await syncing).toBe(false);
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

  it("repairs missing server documents even after the one-time import is marked complete", async () => {
    const d = await db();
    await d.put("meta", true, "shared-library-imported");
    await d.put("docs", doc("phone-only"));
    await d.put("positions", position("phone-only"));
    await service.sync({ changes: [{ kind: "doc", record: doc("desktop-only") }] });
    expect(await syncLibrary()).toBe(true);
    const snapshot = await service.sync({ changes: [] });
    expect(snapshot.docs.map((r) => r.id).sort()).toEqual(["desktop-only", "phone-only"]);
    expect(snapshot.positions[0].docId).toBe("phone-only");
    expect(useLibrarySync.getState().status).toBe("synced");
    expect(await d.count("outbox")).toBe(0);
  });

  it("counts each completed reading, keeps the count when a reread restarts, and syncs it", async () => {
    await docs.put(doc("a"));
    await positions.put(position("a", 10));
    expect((await positions.get("a"))?.reads).toBeUndefined();
    await positions.put({ ...position("a", 20), fraction: 1 }, { completed: true });
    expect((await positions.get("a"))?.reads).toBe(1);
    await positions.put({ ...position("a", 30), index: 0, fraction: 0 });
    expect(await positions.get("a")).toMatchObject({ fraction: 0, reads: 1 });
    await positions.put({ ...position("a", 40), fraction: 1 }, { completed: true });
    expect((await positions.get("a"))?.reads).toBe(2);
    await syncLibrary();
    expect((await service.sync({ changes: [] })).positions[0]).toMatchObject({ reads: 2, updatedAt: 40 });
  });

  it("counts a finish saved before read counts existed once a reread restarts it", async () => {
    await docs.put(doc("a"));
    await (await db()).put("positions", { ...position("a", 10), fraction: 1 });
    await positions.put({ ...position("a", 20), fraction: 0.03 });
    expect(await positions.get("a")).toMatchObject({ fraction: 0.03, reads: 1 });
  });

  it("recovers newer local edits and positions that have no outgoing queue entry", async () => {
    await service.sync({ changes: [{ kind: "doc", record: doc("a", 10) }, { kind: "position", record: position("a", 10) }] });
    const d = await db();
    await d.put("meta", true, "shared-library-imported");
    await d.put("docs", { ...doc("a", 20), title: "Phone title" });
    await d.put("positions", { ...position("a", 20), fraction: 0.75 });
    await syncLibrary();
    const snapshot = await service.sync({ changes: [] });
    expect(snapshot.docs[0]).toMatchObject({ title: "Phone title", updatedAt: 20 });
    expect(snapshot.positions[0]).toMatchObject({ fraction: 0.75, updatedAt: 20 });
  });
});
