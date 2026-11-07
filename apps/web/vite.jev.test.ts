import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LlmKeyStore } from "./vite.llm";
import { jevMiddleware } from "./vite.jev";

describe("Jev key and System One proxy", () => {
  let directory: string, server: Server, url: string;
  let upstream: ReturnType<typeof vi.fn>;
  const start = async (envKey = "") => {
    upstream = vi.fn(async (target: string, init?: RequestInit) => {
      if (new Headers(init?.headers).get("authorization") !== "Bearer ts-key-5678") return Response.json({ detail: "Invalid API key" }, { status: 401 });
      if (target.endsWith("/v1/models")) return Response.json({ data: [] });
      return Response.json({ model: "jev-1.14.0", answers: { category: { type: "choice", choice: "AI agents", confidence: 0.9, probabilities: {} } } });
    });
    const handler = jevMiddleware(new LlmKeyStore(directory, envKey, "typesafe.json"), "https://api.typesafe.example/", upstream as unknown as typeof fetch);
    server = createServer((req, res) => { req.url = req.url?.replace("/api/jev", ""); handler(req, res, () => {}); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jev`;
  };
  const put = (key: string) => fetch(`${url}/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
  const ask = () => fetch(`${url}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"model":"jev-latest"}' });

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-jev-")); });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("asks for a key until one is saved, then forwards questions with it", async () => {
    await start();
    const missing = await ask();
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.message).toMatch(/Settings/);
    expect((await (await put("bad-key")).json()).error.message).toMatch(/TypeSafe didn't accept/);

    expect(await (await put("ts-key-5678")).json()).toEqual({ configured: true, source: "saved", hint: "5678" });
    expect(JSON.parse(await readFile(join(directory, "typesafe.json"), "utf8"))).toEqual({ key: "ts-key-5678" });
    expect((await (await ask()).json()).answers.category.choice).toBe("AI agents");
    const [target, init] = upstream.mock.calls.at(-1)!;
    expect(target).toBe("https://api.typesafe.example/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ts-key-5678");
  });

  it("uses TYPESAFE_API_KEY when nothing is saved and only proxies System One", async () => {
    await start("ts-key-5678");
    expect(await (await fetch(`${url}/config`)).json()).toEqual({ configured: true, source: "env", hint: "5678" });
    expect((await ask()).status).toBe(200);
    expect((await fetch(`${url}/v1/models`)).status).toBe(404);
    expect((await fetch(`${url}/v1/systemone`)).status).toBe(405);
  });
});
