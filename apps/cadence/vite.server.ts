import type { Connect, Plugin, ProxyOptions } from "vite";

/**
 * Cadence's server side: a mount path, and the few ReadAloud API routes the practice engine
 * uses. Everything else (the judge's key, the speech server, word lookups) stays in ReadAloud's
 * web server, which this forwards to.
 */

/** The path Traefik sends to Cadence (deploy/terraform/modules/cadence). */
export const MOUNT = "/cadence";

/**
 * Serve the app under `mount` as well as at the root. The cluster's one web port routes
 * /cadence/* here unchanged, both for the tailnet address (Tailscale maps its root onto
 * /cadence) and for the public one, where Cadence sits beside ReadAloud at /cadence/. The pages
 * use relative addresses, so they work at either.
 */
export function mountAt(mount: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? "/";
    if (url === mount || url.startsWith(`${mount}?`)) {
      // Relative addresses on the page need the trailing slash.
      res.writeHead(308, { location: `${mount}/${url.slice(mount.length)}` });
      return res.end();
    }
    if (url.startsWith(`${mount}/`)) req.url = url.slice(mount.length);
    next();
  };
}

export function mounted(mount = MOUNT): Plugin {
  const middleware = mountAt(mount);
  return {
    name: "cadence:mount",
    // Before the access gate and Vite's own routes, which all expect root paths.
    enforce: "pre",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

/** NPR's text-only site is the only place passages are fetched from. */
const NPR = /^https:\/\/text\.npr\.org\//;

/** Whether a request is one the practice engine makes (packages/practice). */
export function allowed(method: string | undefined, rawUrl: string | undefined): boolean {
  const url = new URL(rawUrl ?? "/", "http://cadence");
  const post = method === "POST";
  switch (url.pathname) {
    case "/api/vs/transcribe":
    case "/api/phonon/v1/audio/speech":
    case "/api/decide/v1/systemone":
    case "/api/jev/v1/systemone":
    case "/api/llm/v1/chat/completions":
      return post;
    case "/api/fetch":
      return method === "GET" && NPR.test(url.searchParams.get("url") ?? "");
    default:
      return false;
  }
}

/**
 * /api/* → ReadAloud's web server at `target`, for the engine's routes only. The Host header
 * is kept, so ReadAloud's own host check and access gate see the address the reader used.
 */
export function practiceApi(target: string): Record<string, ProxyOptions> {
  return {
    "/api": {
      target: target.replace(/\/$/, ""),
      // Checking a reading can wait on a busy speech server.
      timeout: 1_800_000,
      proxyTimeout: 1_800_000,
      bypass(req, res) {
        if (allowed(req.method, req.url)) return undefined;
        res?.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res?.end(JSON.stringify({ error: { message: "Cadence has no such route." } }));
        return false;
      },
      configure(proxy) {
        proxy.on("error", (err, _req, res) => {
          if ("writeHead" in res && !res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: `ReadAloud's server could not be reached: ${err.message}` } }));
          }
        });
      },
    },
  };
}
