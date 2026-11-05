import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

/**
 * GET /api/fetch?url=… fetches a web page server-side and returns it as-is.
 * Most sites send no CORS headers, so the browser can't read them directly;
 * the dev and preview servers can. Only http(s) URLs, GET, and pages up to 5 MB.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function send(res: ServerResponse, status: number, body: string, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return send(res, 400, JSON.stringify({ error: "bad_url" }));
  }
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 ReadAloud",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (!r.ok) return send(res, 502, JSON.stringify({ error: "upstream_status", status: r.status }));
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return send(res, 413, JSON.stringify({ error: "too_large" }));
    send(res, 200, buf.toString("utf8"), r.headers.get("content-type") ?? "text/plain");
  } catch (e) {
    send(res, 502, JSON.stringify({ error: "upstream_unreachable", message: (e as Error).message }));
  }
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  if (req.method !== "GET") return next();
  void handle(req, res);
};

export function pageFetch(): Plugin {
  return {
    name: "readaloud:page-fetch",
    configureServer(server) {
      server.middlewares.use("/api/fetch", middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/fetch", middleware);
    },
  };
}
