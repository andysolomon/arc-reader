import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ACCESS_COOKIE, FUNNEL_HEADER, accessGate } from "./vite.gate";
import { PROBE_IMAGE } from "./vite.shell";

const TOKEN = "s3cret-token-with-enough-entropy";
const FUNNEL = { [FUNNEL_HEADER]: "?1" };

describe("public access through Tailscale Funnel", () => {
  let server: Server, base: string;
  const start = async (token: string) => {
    const gate = accessGate(token);
    server = createServer((req, res) => gate(req, res, () => { res.writeHead(200); res.end("app"); }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    fetch(base + path, { headers, method, redirect: "manual" });
  const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  it("leaves tailnet requests alone", async () => {
    await start(TOKEN);
    expect(await (await get("/library")).text()).toBe("app");
    expect((await get("/api/library", {}, "POST")).status).toBe(200);
  });

  it("refuses Funnel requests without the token, as JSON for the API", async () => {
    await start(TOKEN);
    const page = await get("/library", FUNNEL);
    expect(page.status).toBe(401);
    expect(await page.text()).toMatch(/private/);
    const api = await get("/api/llm/v1/chat/completions", FUNNEL, "POST");
    expect(api.status).toBe(401);
    expect((await api.json()).error.message).toMatch(/private/);
    expect((await get("/?access=wrong", FUNNEL)).status).toBe(401);
    expect((await get("/", { ...FUNNEL, cookie: `${ACCESS_COOKIE}=forged` })).status).toBe(401);
  });

  it("trades the token for a cookie, drops it from the address, and then lets the phone in", async () => {
    await start(TOKEN);
    const unlock = await get(`/read/new?url=x&access=${encodeURIComponent(TOKEN)}`, FUNNEL);
    expect(unlock.status).toBe(303);
    expect(unlock.headers.get("location")).toBe("/read/new?url=x");
    const setCookie = unlock.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).not.toContain(TOKEN);
    const cookie = cookieFrom(unlock);
    expect(await (await get("/read/new?url=x", { ...FUNNEL, cookie: `other=1; ${cookie}` })).text()).toBe("app");
    expect((await get("/api/library", { ...FUNNEL, cookie }, "POST")).status).toBe(200);
  });

  it("lets the iOS offline page check that the server is up", async () => {
    await start(TOKEN);
    expect((await get(`${PROBE_IMAGE}?123`, FUNNEL)).status).toBe(200);
  });

  it("refuses every Funnel request when no token is configured", async () => {
    await start("");
    expect((await get("/", FUNNEL)).status).toBe(401);
    expect((await get("/?access=", FUNNEL)).status).toBe(401);
    expect((await get("/", { ...FUNNEL, cookie: `${ACCESS_COOKIE}=` })).status).toBe(401);
    expect(await (await get("/")).text()).toBe("app");
  });
});
