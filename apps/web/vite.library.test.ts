import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LibraryService, libraryMiddleware } from "./vite.library";
import type { DocRecord, PositionRecord } from "./src/lib/db";

const doc = (id: string, updatedAt = 1): DocRecord => ({ id, title: id, text: "Hello.", source: "paste", domain: "Pasted text", voice: null, chars: 6, createdAt: 1, updatedAt });
const position = (docId: string, updatedAt = 1, fraction = 0.5): PositionRecord => ({ docId, index: 0, offset: 1, fraction, total: 2, updatedAt });

describe("shared server library", () => {
  let directory: string, service: LibraryService;
  let server: Server | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "readaloud-library-"));
    service = new LibraryService(directory);
  });
  afterEach(async () => {
    if (server) { await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; }
    await rm(directory, { recursive: true, force: true });
  });

  it("merges concurrent clients without losing documents, and persists across restarts", async () => {
    await Promise.all([service.sync({ changes: [{ kind: "doc", record: doc("a") }] }), service.sync({ changes: [{ kind: "doc", record: doc("b") }] })]);
    expect((await new LibraryService(directory).sync({ changes: [] })).docs.map((r) => r.id)).toEqual(["a", "b"]);
    expect(JSON.parse(await readFile(join(directory, "library.json"), "utf8")).docs).toHaveLength(2);
  });

  it("merges legacy records by timestamp and accepts newer listening positions even when rewinding", async () => {
    await service.sync({ changes: [{ kind: "doc", record: doc("a", 20) }, { kind: "position", record: position("a", 20, 0.8) }] });
    await service.sync({ changes: [{ kind: "doc", record: doc("a", 10) }, { kind: "position", record: position("a", 10, 0.1) }] });
    const result = await service.sync({ changes: [{ kind: "position", record: position("a", 30, 0.2) }] });
    expect(result.docs[0].updatedAt).toBe(20);
    expect(result.positions[0]).toMatchObject({ updatedAt: 30, fraction: 0.2 });
  });

  it("retains tombstones through restarts and rejects stale re-imports and positions", async () => {
    await service.sync({ changes: [{ kind: "doc", record: doc("a") }, { kind: "position", record: position("a") }] });
    await service.sync({ changes: [{ kind: "delete", docId: "a" }] });
    expect(await new LibraryService(directory).sync({ changes: [{ kind: "doc", record: doc("a", 100) }, { kind: "position", record: position("a", 100) }] })).toEqual({ docs: [], positions: [], deleted: ["a"] });
  });

  it("stores the completed reading count on positions", async () => {
    expect((await service.sync({ changes: [{ kind: "doc", record: doc("a") }, { kind: "position", record: { ...position("a"), reads: 2 } }] })).positions[0].reads).toBe(2);
  });

  it("never lets an older client or a stale position lower the read count, and counts a legacy finish once", async () => {
    await service.sync({ changes: [{ kind: "doc", record: doc("a") }, { kind: "position", record: { ...position("a", 10), reads: 2 } }] });
    expect((await service.sync({ changes: [{ kind: "position", record: position("a", 20, 0.1) }] })).positions[0]).toMatchObject({ fraction: 0.1, reads: 2 });
    expect((await service.sync({ changes: [{ kind: "position", record: { ...position("a", 5), reads: 3 } }] })).positions[0]).toMatchObject({ fraction: 0.1, updatedAt: 20, reads: 3 });
    await service.sync({ changes: [{ kind: "doc", record: doc("b") }, { kind: "position", record: position("b", 10, 1) }] });
    expect((await service.sync({ changes: [{ kind: "position", record: position("b", 20, 0.03) }] })).positions.find((p) => p.docId === "b")).toMatchObject({ fraction: 0.03, reads: 1 });
  });

  it("validates the entire batch before writing and leaves damaged storage intact", async () => {
    expect(() => service.sync({ changes: [{ kind: "doc", record: doc("a") }, { kind: "position", record: { ...position("a"), fraction: 2 } }] })).toThrow("Invalid library change");
    expect(() => service.sync({ changes: [{ kind: "doc", record: doc("a") }, { kind: "position", record: { ...position("a"), reads: 1.5 } }] })).toThrow("Invalid library change");
    expect((await service.sync({ changes: [] })).docs).toEqual([]);
    await writeFile(join(directory, "library.json"), "damaged");
    await expect(service.sync({ changes: [{ kind: "doc", record: doc("b") }] })).rejects.toThrow();
    expect(await readFile(join(directory, "library.json"), "utf8")).toBe("damaged");
  });

  it("stores document summaries and rejects malformed ones", async () => {
    const summary = { source: "abc:6", text: "Short.", model: "glm-5.3", version: 1, createdAt: 2 };
    const result = await service.sync({ changes: [{ kind: "doc", record: { ...doc("a"), summary } }] });
    expect(result.docs[0].summary).toEqual(summary);
    const bad = { ...doc("b"), summary: { ...summary, text: 5 } } as unknown as DocRecord;
    expect(() => service.sync({ changes: [{ kind: "doc", record: bad }] })).toThrow("Invalid library change");
  });

  it("syncs code explanations and narration positions, and validates their shapes", async () => {
    const visualDescriptions = { "visual-v1:abc:20": "A diagram connects the client to a server." };
    const codeSummaries = { "v1:abc:10": "This example prints a greeting." };
    const result = await service.sync({ changes: [
      { kind: "doc", record: { ...doc("code"), codeSummaries, visualDescriptions } },
      { kind: "position", record: { ...position("code"), narrationVersion: 1 } },
    ] });
    expect(result.docs[0].codeSummaries).toEqual(codeSummaries);
    expect(result.docs[0].visualDescriptions).toEqual(visualDescriptions);
    expect(result.positions[0].narrationVersion).toBe(1);
    const bad = { ...doc("bad"), codeSummaries: { key: 3 } } as unknown as DocRecord;
    expect(() => service.sync({ changes: [{ kind: "doc", record: bad }] })).toThrow("Invalid library change");
  });

  it("serves JSON sync over HTTP and rejects cross-site writes and malformed requests", async () => {
    const handler = libraryMiddleware(service);
    server = createServer((req, res) => { req.url = req.url?.replace("/api/library", ""); handler(req, res, () => {}); });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/library/sync`;
    const post = (body: string, origin?: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body });
    expect((await post("{}", "https://other.example")).status).toBe(403);
    expect((await post("invalid")).status).toBe(400);
    expect((await fetch(url)).status).toBe(405);
    const response = await post(JSON.stringify({ changes: [{ kind: "doc", record: doc("http") }] }), new URL(url).origin);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).docs[0].id).toBe("http");
  });
});
