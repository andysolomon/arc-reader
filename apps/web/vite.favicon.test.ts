import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { FaviconService, iconLinks, isHostname, resolveFavicon } from "./vite.favicon";

describe("site favicons", () => {
  let site: Server, origin: string;
  let html: string, icons: Record<string, { type: string; body: string }>, hits: string[];
  beforeEach(async () => {
    hits = [];
    html = "";
    icons = {};
    site = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/") { res.setHeader("content-type", "text/html"); return res.end(html); }
      const icon = icons[req.url ?? ""];
      if (!icon) { res.writeHead(404); return res.end("missing"); }
      res.setHeader("content-type", icon.type);
      res.end(icon.body);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise((resolve) => site.close(resolve)); });

  it("accepts hostnames only", () => {
    expect(isHostname("example.com")).toBe(true);
    expect(isHostname("news.ycombinator.com")).toBe(true);
    expect(isHostname("localhost")).toBe(false);
    expect(isHostname("127.0.0.1")).toBe(false);
    expect(isHostname("evil.com/../x")).toBe(false);
    expect(isHostname("")).toBe(false);
  });

  it("reads icon links in document order, skipping data URIs", () => {
    const page = `<head><link rel=stylesheet href=a.css><link rel="icon" href="data:image/png;base64,AA"><link rel='shortcut icon' href='/fav.png'><link href="https://cdn.example/touch.png" rel="apple-touch-icon"></head>`;
    expect(iconLinks(page, "https://example.com/")).toEqual(["https://example.com/fav.png", "https://cdn.example/touch.png"]);
  });

  it("prefers the declared icon and falls back to /favicon.ico", async () => {
    html = `<html><head><link rel="icon" href="/static/icon.svg"></head></html>`;
    icons["/static/icon.svg"] = { type: "image/svg+xml", body: "<svg/>" };
    icons["/favicon.ico"] = { type: "image/x-icon", body: "ico" };
    expect(await resolveFavicon(origin)).toEqual({ type: "image/svg+xml", body: Buffer.from("<svg/>") });
    expect(hits).toEqual(["/", "/static/icon.svg"]);

    hits.length = 0;
    html = `<html><head><link rel="icon" href="/gone.png"></head></html>`;
    expect(await resolveFavicon(origin)).toEqual({ type: "image/x-icon", body: Buffer.from("ico") });
    expect(hits).toEqual(["/", "/gone.png", "/favicon.ico"]);
  });

  it("returns nothing when the site has no icon", async () => {
    html = "<html></html>";
    expect(await resolveFavicon(origin)).toBeNull();
  });

  it("serves icons with cache headers and remembers misses", async () => {
    const seen: string[] = [];
    const service = new FaviconService(async (o) => { seen.push(o); return o.includes("has") ? { type: "image/png", body: Buffer.from("png") } : null; });
    const api = createServer((req, res) => { void service.handle(req, res); });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/api/favicon?host=has.example`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/png");
      expect(ok.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(await ok.text()).toBe("png");
      await fetch(`${base}/api/favicon?host=HAS.example`);
      expect((await fetch(`${base}/api/favicon?host=none.example`)).status).toBe(404);
      expect((await fetch(`${base}/api/favicon?host=none.example`)).status).toBe(404);
      expect((await fetch(`${base}/api/favicon?host=localhost`)).status).toBe(400);
      expect(seen).toEqual(["https://has.example", "https://none.example"]);
    } finally {
      await new Promise((resolve) => api.close(resolve));
    }
  });
});
