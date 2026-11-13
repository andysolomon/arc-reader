import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AvatarDirector } from "./vite.avatar-direction";
import { LlmKeyStore } from "./vite.llm";
import { AvatarStore, avatarMiddleware, avatarPrompt, parseAvatarVoice } from "./vite.avatars";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBPkAAAAASUVORK5CYII=", "base64");
const voice = { id: "new-clone", name: "Narrator", engine: "omnivoice", kind: "profile" as const, hue: 155, description: "male, elderly, gentle narrator" };
const imageResponse = () => Response.json({ data: [{ b64_json: png.toString("base64") }] });
let directory: string;
let servers: Server[];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-avatars-")); servers = []; });
afterEach(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
const terminal = async (store: AvatarStore) => {
  await vi.waitFor(async () => expect((await store.list()).records.every((r) => ["ready", "failed"].includes(r.status))).toBe(true));
  return (await store.list()).records;
};
const serve = async (store: AvatarStore) => {
  const middleware = avatarMiddleware(store);
  const server = createServer((req, res) => { req.url = req.url?.replace("/api/avatars", ""); void middleware(req, res, () => {}); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/avatars`;
};

describe("persistent voice avatar generation", () => {
  it("deduplicates concurrent devices, retains identity through rename/engine change, and reuses saved images after restart", async () => {
    const upstream = vi.fn(async () => imageResponse());
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream);
    await Promise.all([store.ensure(voice), store.ensure({ ...voice, name: "Renamed", engine: "voxcpm2" })]);
    const [record] = await terminal(store);
    expect(record.status).toBe("ready");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await store.image(record.url!.split("/").at(-1)!)).toEqual(png);
    const restart = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream);
    await restart.ensure(voice);
    expect((await restart.list()).records[0].url).toBe(record.url);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await store.list())).not.toContain("secret");
  });

  it("runs one generation at a time and preserves distinct engine identities", async () => {
    let complete!: (r: Response) => void;
    const upstream = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream);
    await store.ensure({ ...voice, kind: "preset", engine: "engine-a" });
    await store.ensure({ ...voice, kind: "preset", engine: "engine-b" });
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    complete(imageResponse());
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2));
    complete(imageResponse());
    expect((await terminal(store)).map((r) => r.status)).toEqual(["ready", "ready"]);
  });

  it("does not automatically rebill failures; explicit retry succeeds", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json({ error: "private provider details" }, { status: 403 })).mockResolvedValueOnce(imageResponse());
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream);
    await store.ensure(voice);
    expect((await terminal(store))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("image access") });
    await store.ensure(voice);
    expect(upstream).toHaveBeenCalledTimes(1);
    await store.ensure(voice, true);
    expect((await terminal(store))[0].status).toBe("ready");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("marks interrupted generations for manual retry on restart", async () => {
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, vi.fn(async () => imageResponse()));
    await store.ensure(voice);
    await terminal(store);
    const file = (await readdir(directory)).find((name) => name.endsWith(".json"))!;
    const record = JSON.parse(await readFile(join(directory, file), "utf8"));
    await writeFile(join(directory, file), JSON.stringify({ ...record, status: "generating" }));
    const upstream = vi.fn();
    const restored = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream);
    expect((await restored.list()).records[0].status).toBe("failed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects invalid images and does not expose provider errors", async () => {
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, vi.fn(async () => Response.json({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] })));
    await store.ensure(voice);
    const [record] = await terminal(store);
    expect(record.status).toBe("failed");
    expect(record.url).toBeUndefined();
  });

  it("validates request metadata, origin and image paths while serving immutable PNGs", async () => {
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, vi.fn(async () => imageResponse()));
    const url = await serve(store);
    const post = (body: unknown, origin?: string) => fetch(`${url}/ensure`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    expect((await post({ voice }, "https://elsewhere.example")).status).toBe(403);
    expect((await post({ voice: { ...voice, id: "" } })).status).toBe(400);
    expect((await post({ voice: { ...voice, tags: [3] } })).status).toBe(400);
    expect((await post({ voice: { ...voice, name: "x".repeat(40000) } })).status).toBe(413);
    expect((await post({ voice })).status).toBe(202);
    const [record] = await terminal(store);
    const response = await fetch(`${url}/images/${record.url!.split("/").at(-1)}`);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(await store.image("../anything")).toBeNull();
    expect(JSON.stringify(await (await fetch(`${url}/`)).json())).not.toContain("secret");
  });

  it("persists Jev direction before drawing and reuses the completed portrait without reviewing again", async () => {
    const jev = vi.fn(async () => Response.json({ model: "jev-test", answers: {
      personality: { choice: "calm", confidence: 0.95 },
      gender_metadata: { choice: "consistent", confidence: 0.95 },
      age_metadata: { choice: "consistent", confidence: 0.95 },
      design: { choice: "design_0", confidence: 0.95 },
      ...Object.fromEntries([0, 1, 2, 3].map((i) => [`similar_${i}`, { noul: 0.1 }])),
    } }));
    const director = new AvatarDirector(new LlmKeyStore(directory, "jev-secret", "typesafe.json"), undefined, jev);
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      const records = await store.list();
      expect(records.records[0].review?.status).toBe("reviewed");
      expect(JSON.parse(init!.body as string).prompt).toContain('"expression":"calm"');
      return imageResponse();
    });
    const store = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream, director);
    await store.ensure(voice);
    const [record] = await terminal(store);
    expect(record.status).toBe("ready");
    expect(record.review?.model).toBe("jev-test");
    const restored = new AvatarStore(directory, { OPENAI_API_KEY: "secret" }, upstream, director);
    await restored.ensure(voice);
    expect((await restored.list()).records[0].direction).toEqual(record.direction);
    expect(jev).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("reports missing configuration without attempting a paid request", async () => {
    const upstream = vi.fn();
    const store = new AvatarStore(directory, {}, upstream);
    const url = await serve(store);
    expect((await fetch(`${url}/ensure`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voice }) })).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("directs illustrations from metadata and keeps unclassified clones neutral", () => {
    expect(avatarPrompt(voice, "123456")).toContain('"presentation":"male"');
    expect(avatarPrompt({ ...voice, description: "", name: "Jane" }, "123456")).toContain('"presentation":"neutral"');
    expect(parseAvatarVoice({ ...voice, arbitrary: "not forwarded" })).not.toHaveProperty("arbitrary");
  });
});
