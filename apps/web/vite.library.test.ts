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

  it("validates the entire batch before writing and leaves damaged storage intact", async () => {
    expect(() => service.sync({ changes: [{ kind: "doc", record: doc("a") }, { kind: "position", record: { ...position("a"), fraction: 2 } }] })).toThrow("Invalid library change");
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
