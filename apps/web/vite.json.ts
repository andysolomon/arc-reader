import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

/**
 * JSON answers for endpoints a phone polls every few seconds, often over a slow or
 * relayed tunnel. Larger bodies are gzipped for clients that accept it. With `etag`,
 * a client that already holds this exact body gets 304 and nothing else.
 */
export function sendJson(req: IncomingMessage | undefined, res: ServerResponse, status: number, data: unknown, opts: { etag?: boolean } = {}) {
  const body = Buffer.from(JSON.stringify(data));
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store", vary: "accept-encoding" };
  if (opts.etag && status === 200) {
    headers.etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
    if (req?.headers["if-none-match"] === headers.etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
  }
  if (body.length > 1024 && /\bgzip\b/.test(String(req?.headers["accept-encoding"] ?? ""))) {
    const zipped = gzipSync(body);
    res.writeHead(status, { ...headers, "content-encoding": "gzip", "content-length": String(zipped.length) });
    res.end(zipped);
    return;
  }
  res.writeHead(status, { ...headers, "content-length": String(body.length) });
  res.end(body);
}
