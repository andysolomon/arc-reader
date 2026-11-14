import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LlmKeyStore } from "./vite.llm";
import { decideMiddleware } from "./vite.decide";

describe("Reading Practice judge proxy", () => {
  let directory: string, server: Server, url: string;
  let upstream: ReturnType<typeof vi.fn>;
  const start = async (envKey = "") => {
    upstream = vi.fn(async (_target: string, init?: RequestInit) => {
      if (new Headers(init?.headers).get("authorization") !== "Bearer oc-key-1234") return Response.json({ error: "bad key" }, { status: 401 });
      return Response.json({ model: "gemini-decision-1", answers: { w_0: { type: "choice", choice: "correct", confidence: 0.97 } } });
    });
    const handler = decideMiddleware(new LlmKeyStore(directory, envKey), "https://opencode.example/inference/systemone/v1/", upstream as unknown as typeof fetch);
    server = createServer((req, res) => { req.url = req.url?.replace("/api/decide", ""); handler(req, res, () => {}); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/decide`;
  };
  const ask = (payload: unknown = { model: "gemini-decision-1", state: [], questions: {} }, headers: Record<string, string> = {}) =>
    fetch(`${url}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-decide-")); });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("asks for the OpenCode key until one exists", async () => {
    await start();
    const missing = await ask();
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.message).toMatch(/OpenCode key in Settings/);
    expect(await (await fetch(`${url}/config`)).json()).toEqual({ configured: false, source: null, hint: null });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards Gemini Decision requests to OpenCode with the shared key", async () => {
    await start("oc-key-1234");
    const response = await ask();
    expect(response.status).toBe(200);
    expect((await response.json()).answers.w_0.choice).toBe("correct");
    const [target, init] = upstream.mock.calls.at(-1)!;
    expect(target).toBe("https://opencode.example/inference/systemone/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer oc-key-1234");
    expect(JSON.parse(Buffer.from(init.body as Uint8Array).toString("utf8")).model).toBe("gemini-decision-1");
  });

  it("refuses other models, bad JSON, other paths, other methods and other origins", async () => {
    await start("oc-key-1234");
    expect((await ask({ model: "jev-latest", questions: {} })).status).toBe(400);
    expect((await ask("{not json")).status).toBe(400);
    expect((await fetch(`${url}/v1/models`)).status).toBe(404);
    expect((await fetch(`${url}/v1/systemone`)).status).toBe(405);
    expect((await fetch(`${url}/config`, { method: "PUT", body: "{}" })).status).toBe(405);
    expect((await ask(undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects recordings over the size limit", async () => {
    await start("oc-key-1234");
    const response = await ask({ model: "gemini-decision-1", state: "x".repeat(17 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect((await response.json()).error.message).toMatch(/too large/);
  });
});
