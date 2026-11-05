import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LlmKeyStore, llmMiddleware } from "./vite.llm";

describe("LLM key and chat proxy", () => {
  let directory: string, server: Server, url: string;
  let upstream: ReturnType<typeof vi.fn>;
  const start = async (envKey = "") => {
    upstream = vi.fn(async (target: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== "Bearer good-key-1234" && auth !== "Bearer env-key-9999") return Response.json({ error: { message: "Invalid credential" } }, { status: 401 });
      if (target.endsWith("/v1/models")) return Response.json({ data: [] });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Summary." } }] });
    });
    const handler = llmMiddleware(new LlmKeyStore(directory, envKey), "https://llm.example/zen/go/", upstream as unknown as typeof fetch);
    server = createServer((req, res) => { req.url = req.url?.replace("/api/llm", ""); handler(req, res, () => {}); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/llm`;
  };
  const put = (key: string, headers: Record<string, string> = {}) => fetch(`${url}/config`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ key }) });
  const chat = () => fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-opencode-session": "readaloud-summary-d" }, body: '{"model":"m"}' });

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-llm-")); });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("asks for a key until one is saved, then forwards chat with it", async () => {
    await start();
    expect(await (await fetch(`${url}/config`)).json()).toEqual({ configured: false, source: null, hint: null });
    const missing = await chat();
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.message).toMatch(/Settings/);

    const saved = await put(" good-key-1234 ");
    expect(await saved.json()).toEqual({ configured: true, source: "saved", hint: "1234" });
    expect((await stat(join(directory, "llm.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(directory, "llm.json"), "utf8"))).toEqual({ key: "good-key-1234" });

    const response = await chat();
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: "Summary." } }] });
    const [target, init] = upstream.mock.calls.at(-1)!;
    expect(target).toBe("https://llm.example/zen/go/v1/chat/completions");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer good-key-1234");
    expect(headers.get("user-agent")).toBe("readaloud/0.1");
    expect(headers.get("x-opencode-session")).toBe("readaloud-summary-d");
  });

  it("rejects keys OpenCode refuses and never returns the key", async () => {
    await start();
    const refused = await put("bad-key");
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.message).toMatch(/didn't accept/);
    expect((await put("has space")).status).toBe(400);
    expect(await (await fetch(`${url}/config`)).json()).toEqual({ configured: false, source: null, hint: null });
  });

  it("prefers a saved key over LLM_API_KEY and falls back to it after removal", async () => {
    await start("env-key-9999");
    expect(await (await fetch(`${url}/config`)).json()).toEqual({ configured: true, source: "env", hint: "9999" });
    await put("good-key-1234");
    expect((await (await fetch(`${url}/config`)).json()).source).toBe("saved");
    expect(await (await fetch(`${url}/config`, { method: "DELETE" })).json()).toEqual({ configured: true, source: "env", hint: "9999" });
  });

  it("refuses cross-site writes and other endpoints", async () => {
    await start();
    expect((await put("good-key-1234", { origin: "https://evil.example" })).status).toBe(403);
    expect((await fetch(`${url}/v1/models`)).status).toBe(404);
    expect((await fetch(`${url}/v1/chat/completions`)).status).toBe(405);
  });
});
