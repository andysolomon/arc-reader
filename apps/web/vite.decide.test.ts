import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LlmKeyStore } from "./vite.llm";
import { decideMiddleware, googleRequest } from "./vite.decide";

const REQUEST = {
  model: "gemini-decision-1",
  state: [{ type: "text", text: "Passage: I was born." }, { type: "input_audio", input_audio: { data: "UklGRg==", format: "wav" } }],
  questions: { w_0: { type: "choice", instructions: "How?", criteria: { correct: "Said it", skipped: "Left out" } } },
};

describe("Reading Practice judge proxy", () => {
  let directory: string, server: Server, url: string;
  let upstream: ReturnType<typeof vi.fn>;
  const start = async ({ gemini = "", opencode = "" } = {}) => {
    upstream = vi.fn(async (target: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (target.startsWith("https://google.example/")) {
        if (headers.get("x-goog-api-key") !== "gm-key-9876") return Response.json({ error: { code: 400, message: "API key not valid." } }, { status: 400 });
        if (target.endsWith("/models/gemini-decision-1")) return Response.json({ name: "models/gemini-decision-1" });
        return Response.json({ answers: { w_0: { type: "choice", choice: "correct", confidence: 0.97 } } });
      }
      if (headers.get("authorization") !== "Bearer oc-key-1234") return Response.json({ error: "bad key" }, { status: 401 });
      return Response.json({ model: "gemini-decision-1", answers: { w_0: { type: "choice", choice: "skipped", confidence: 0.9 } } });
    });
    const handler = decideMiddleware(
      { gemini: new LlmKeyStore(directory, gemini, "gemini.json"), opencode: new LlmKeyStore(directory, opencode) },
      { google: "https://google.example/v1beta/", opencode: "https://opencode.example/inference/systemone/v1/" },
      upstream as unknown as typeof fetch,
    );
    server = createServer((req, res) => { req.url = req.url?.replace("/api/decide", ""); handler(req, res, () => {}); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/decide`;
  };
  const ask = (payload: unknown = REQUEST, headers: Record<string, string> = {}) =>
    fetch(`${url}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
  const put = (key: string) => fetch(`${url}/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-decide-")); });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("asks for a Gemini key until one is saved, then sends Google its own format", async () => {
    await start();
    const missing = await ask();
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.message).toMatch(/Gemini API key in Settings/);
    expect((await (await put("bad-key")).json()).error.message).toMatch(/Google didn't accept/);

    expect(await (await put("gm-key-9876")).json()).toEqual({ configured: true, source: "saved", hint: "9876" });
    expect(JSON.parse(await readFile(join(directory, "gemini.json"), "utf8"))).toEqual({ key: "gm-key-9876" });
    expect((await stat(join(directory, "gemini.json"))).mode & 0o777).toBe(0o600);

    const response = await ask();
    expect(response.status).toBe(200);
    expect((await response.json()).answers.w_0.choice).toBe("correct");
    const [target, init] = upstream.mock.calls.at(-1)!;
    expect(target).toBe("https://google.example/v1beta/decisions");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("gm-key-9876");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gemini-decision-1",
      input: [{ type: "text", text: "Passage: I was born." }, { type: "audio", data: "UklGRg==", mime_type: "audio/wav" }],
      questions: REQUEST.questions,
    });

    expect((await fetch(`${url}/config`, { method: "DELETE" })).status).toBe(200);
    expect((await ask()).status).toBe(503);
  });

  it("uses GEMINI_API_KEY from the environment, ahead of an OpenCode key", async () => {
    await start({ gemini: "gm-key-9876", opencode: "oc-key-1234" });
    expect(await (await fetch(`${url}/config`)).json()).toEqual({ configured: true, source: "env", hint: "9876" });
    expect((await (await ask()).json()).answers.w_0.choice).toBe("correct");
    expect(upstream.mock.calls.at(-1)![0]).toBe("https://google.example/v1beta/decisions");
  });

  it("falls back to OpenCode's System One with the summaries key when there is no Gemini key", async () => {
    await start({ opencode: "oc-key-1234" });
    const response = await ask();
    expect((await response.json()).answers.w_0.choice).toBe("skipped");
    const [target, init] = upstream.mock.calls.at(-1)!;
    expect(target).toBe("https://opencode.example/inference/systemone/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer oc-key-1234");
    expect(JSON.parse(Buffer.from(init.body as Uint8Array).toString("utf8"))).toEqual(REQUEST);
  });

  it("refuses other models, bad input, other paths, other methods and other origins", async () => {
    await start({ gemini: "gm-key-9876" });
    expect((await ask({ model: "jev-latest", questions: {} })).status).toBe(400);
    expect((await ask("{not json")).status).toBe(400);
    expect((await ask({ ...REQUEST, state: [{ type: "image_url", image_url: "x" }] })).status).toBe(400);
    expect((await fetch(`${url}/v1/models`)).status).toBe(404);
    expect((await fetch(`${url}/v1/systemone`)).status).toBe(405);
    expect((await ask(undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects recordings over the size limit", async () => {
    await start({ gemini: "gm-key-9876" });
    const response = await ask({ model: "gemini-decision-1", state: "x".repeat(17 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect((await response.json()).error.message).toMatch(/too large/);
  });
});

describe("googleRequest", () => {
  it("accepts plain text as the state", () => {
    expect(googleRequest({ model: "gemini-decision-1", state: "Some text", questions: {} }).input).toEqual([{ type: "text", text: "Some text" }]);
  });
});
