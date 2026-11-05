import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

/**
 * GET /api/favicon?host=example.com returns the site's icon, fetched server-side so the
 * browser never reports which sites are in the library to a third-party icon service.
 * Reads the page's <link rel="icon"> first, then /favicon.ico. Results, including misses,
 * are cached in memory for a day.
 */

const PAGE_BYTES = 256 * 1024;
const ICON_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const TTL_MS = 24 * 60 * 60 * 1000;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 ReadAloud";

export interface Icon {
  type: string;
  body: Buffer;
}

export function isHostname(host: string): boolean {
  return host.length <= 253 && HOST.test(host) && !/^\d+(\.\d+){3}$/.test(host);
}

/** `<link rel="icon">` candidates in document order; the first that loads wins. */
export function iconLinks(html: string, base: string): string[] {
  const links: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    if (!value || value.startsWith("data:")) continue;
    try {
      links.push(new URL(value, base).href);
    } catch {
      // Unparseable href; try the next candidate.
    }
  }
  return links;
}

async function get(url: string, limit: number): Promise<Response | null> {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": USER_AGENT } });
    if (!r.ok) return null;
    const length = Number(r.headers.get("content-length") ?? 0);
    return length > limit ? null : r;
  } catch {
    return null;
  }
}

async function loadIcon(url: string): Promise<Icon | null> {
  const r = await get(url, ICON_BYTES);
  if (!r) return null;
  const type = r.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const body = Buffer.from(await r.arrayBuffer());
  if (!body.byteLength || body.byteLength > ICON_BYTES) return null;
  if (!type.startsWith("image/") && !url.endsWith(".ico")) return null;
  return { type: type.startsWith("image/") ? type : "image/x-icon", body };
}

/** Resolve the icon for a site origin such as https://example.com. */
export async function resolveFavicon(origin: string): Promise<Icon | null> {
  const page = await get(origin + "/", PAGE_BYTES);
  const candidates: string[] = [];
  if (page) {
    const html = (await page.text()).slice(0, PAGE_BYTES);
    candidates.push(...iconLinks(html, page.url || origin + "/"));
  }
  candidates.push(new URL("/favicon.ico", page?.url || origin + "/").href);
  for (const url of new Set(candidates)) {
    const icon = await loadIcon(url);
    if (icon) return icon;
  }
  return null;
}

export class FaviconService {
  private cache = new Map<string, { until: number; icon: Promise<Icon | null> }>();
  constructor(private resolve: (origin: string) => Promise<Icon | null> = resolveFavicon) {}

  lookup(host: string): Promise<Icon | null> {
    const key = host.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.icon;
    const icon = this.resolve(`https://${key}`).catch(() => null);
    this.cache.set(key, { until: Date.now() + TTL_MS, icon });
    return icon;
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const host = new URL(req.url ?? "", "http://localhost").searchParams.get("host") ?? "";
    if (!isHostname(host)) {
      res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ error: "bad_host" }));
    }
    const icon = await this.lookup(host);
    if (!icon) {
      res.writeHead(404, { "content-type": "application/json", "cache-control": "public, max-age=3600" });
      return res.end(JSON.stringify({ error: "no_icon" }));
    }
    res.writeHead(200, { "content-type": icon.type, "content-length": icon.body.byteLength, "cache-control": "public, max-age=86400" });
    res.end(icon.body);
  }
}

export function siteFavicons(): Plugin {
  const service = new FaviconService();
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.method !== "GET") return next();
    void service.handle(req, res);
  };
  return {
    name: "readaloud:site-favicons",
    configureServer(server) {
      server.middlewares.use("/api/favicon", middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/favicon", middleware);
    },
  };
}
