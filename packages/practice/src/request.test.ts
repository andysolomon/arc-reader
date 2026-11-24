import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { request } from "./request";

/** A server that takes each request and then does `answer` with it, which may be nothing at all. */
async function serve(answer: (res: ServerResponse) => void): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => answer(res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

describe("request", () => {
  let server: Server | undefined;
  afterEach(() => { server?.closeAllConnections(); server?.close(); });

  it("gives up on a server that never answers", async () => {
    let url: string;
    ({ server, url } = await serve(() => {}));
    const started = Date.now();
    await expect(request(url, { timeoutMs: 200 })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("gives up on a body that stops arriving", async () => {
    let url: string;
    ({ server, url } = await serve((res) => { res.writeHead(200); res.write("first part"); }));
    const response = await request(url, { timeoutMs: 300 });
    await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("stops when the caller's signal aborts first", async () => {
    let url: string;
    ({ server, url } = await serve(() => {}));
    const reader = new AbortController();
    setTimeout(() => reader.abort(), 50);
    await expect(request(url, { timeoutMs: 60_000, signal: reader.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns the answer of a server that replies in time", async () => {
    let url: string;
    ({ server, url } = await serve((res) => res.end("ok")));
    expect(await (await request(url, { timeoutMs: 5000 })).text()).toBe("ok");
  });
});
