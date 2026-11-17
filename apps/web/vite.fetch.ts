import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { FXTWITTER_API, xPostHtml, xPostId, type FxTweet } from "./vite.xpost";
import { MAX_PDF_BYTES, isPdf, isPdfType, pdfPage, type SlidePictures } from "./vite.pdf";
import { SLIDE_ROUTE, SlideStore, slideMiddleware } from "./vite.slides";

/**
 * GET /api/fetch?url=… fetches a web page server-side and returns it as-is.
 * Most sites send no CORS headers, so the browser can't read them directly;
 * the dev and preview servers can. Only http(s) URLs, GET, and pages up to 5 MB.
 * X posts come from FxTwitter's API as HTML, since x.com itself serves only a script shell.
 * A PDF, up to 60 MB, comes back as an HTML page of its text; POST /api/fetch/pdf does the
 * same for a PDF file sent as the request body. A deck's slides that show more than text come
 * with pictures, served from /api/slides.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** A deck of slides runs to tens of megabytes. */
const PDF_TIMEOUT_MS = 120_000;

function send(res: ServerResponse, status: number, body: string, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

/** What the server got for a page: its body as text, or a JSON error to pass on. */
export interface Upstream {
  status: number;
  type: string;
  body: string;
}

const failure = (status: number, error: Record<string, unknown>): Upstream => ({ status, type: "application/json", body: JSON.stringify(error) });

/** Fetch a page the way /api/fetch answers for it: a PDF as an HTML page of its text, an X post as HTML. */
export async function fetchUpstream(url: URL, pictures?: SlidePictures): Promise<Upstream> {
  const postId = xPostId(url);
  if (postId) return fetchXPost(postId);
  const slow = new AbortController();
  let timer = setTimeout(() => slow.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: slow.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 ReadAloud",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (!r.ok) return failure(502, { error: "upstream_status", status: r.status });
    const type = r.headers.get("content-type") ?? "";
    if (Number(r.headers.get("content-length")) > MAX_PDF_BYTES) return failure(413, { error: "too_large" });
    if (isPdfType(type)) {
      clearTimeout(timer);
      timer = setTimeout(() => slow.abort(), PDF_TIMEOUT_MS);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (isPdf(buf, type)) return await readPdf(buf, r.url || url.href, pictures);
    if (buf.byteLength > MAX_BYTES) return failure(413, { error: "too_large" });
    return { status: 200, type: type || "text/plain", body: buf.toString("utf8") };
  } catch (e) {
    return failure(502, { error: "upstream_unreachable", message: (e as Error).message });
  } finally {
    clearTimeout(timer);
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, pictures?: SlidePictures) {
  const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return send(res, 400, JSON.stringify({ error: "bad_url" }));
  }
  const { status, body, type } = await fetchUpstream(url, pictures);
  send(res, status, body, type);
}

async function readPdf(bytes: Buffer, url: string, pictures?: SlidePictures): Promise<Upstream> {
  if (bytes.byteLength > MAX_PDF_BYTES) return failure(413, { error: "too_large" });
  const html = await pdfPage(bytes, url, pictures);
  // A scan has pictures of its pages and no text to read.
  if (!html) return failure(422, { error: "unreadable_pdf" });
  return { status: 200, type: "text/html; charset=utf-8", body: html };
}

/** A PDF chosen from the device: the file is the request body, its name the `name` parameter. */
async function handleUpload(req: IncomingMessage, res: ServerResponse, pictures?: SlidePictures) {
  const name = new URL(req.url ?? "", "http://localhost").searchParams.get("name") ?? "";
  if (Number(req.headers["content-length"]) > MAX_PDF_BYTES) return send(res, 413, JSON.stringify({ error: "too_large" }));
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).byteLength;
      if (size > MAX_PDF_BYTES) return send(res, 413, JSON.stringify({ error: "too_large" }));
      chunks.push(chunk as Buffer);
    }
  } catch {
    return send(res, 400, JSON.stringify({ error: "bad_upload" }));
  }
  const bytes = Buffer.concat(chunks);
  if (!isPdf(bytes)) return send(res, 415, JSON.stringify({ error: "not_a_pdf" }));
  const { status, body, type } = await readPdf(bytes, `file:///${encodeURIComponent(name)}`, pictures);
  send(res, status, body, type);
}

async function fetchXPost(id: string): Promise<Upstream> {
  try {
    const r = await fetch(`${FXTWITTER_API}/status/${id}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "ReadAloud" } });
    if (!r.ok) return failure(502, { error: "upstream_status", status: r.status });
    const { tweet } = await r.json() as { tweet?: FxTweet };
    if (!tweet) return failure(502, { error: "upstream_status", status: r.status });
    return { status: 200, type: "text/html; charset=utf-8", body: xPostHtml(tweet) };
  } catch (e) {
    return failure(502, { error: "upstream_unreachable", message: (e as Error).message });
  }
}

export const fetchMiddleware = (pictures?: SlidePictures): Connect.NextHandleFunction => (req, res, next) => {
  if (req.method === "POST" && req.url?.split("?")[0] === "/pdf") return void handleUpload(req, res, pictures);
  if (req.method !== "GET") return next();
  void handle(req, res, pictures);
};

/** Beside the shared library, so slide pictures live in the same volume. */
export const slideStore = (env: Record<string, string> = {}) => new SlideStore(resolve(env.LIBRARY_DATA_DIR || ".readaloud-library", "slides"));

export function pageFetch(env: Record<string, string> = {}, slides = slideStore(env)): Plugin {
  const middleware = fetchMiddleware(slides);
  const pictures = slideMiddleware(slides);
  return {
    name: "readaloud:page-fetch",
    configureServer(server) {
      server.middlewares.use("/api/fetch", middleware);
      server.middlewares.use(SLIDE_ROUTE, pictures);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/fetch", middleware);
      server.middlewares.use(SLIDE_ROUTE, pictures);
    },
  };
}
