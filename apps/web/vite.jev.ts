import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { HttpError, LlmKeyStore, body, keyConfig } from "./vite.llm";

const USER_AGENT = "readaloud/0.1";

/**
 * /api/jev: the TypeSafe key and System One requests to Jev, which files documents into library categories.
 * The key stays on this server; the browser sends questions and gets typed answers back.
 */
export function jevMiddleware(store: LlmKeyStore, upstream: string, fetchImpl: typeof fetch = fetch): Connect.NextHandleFunction {
  const base = upstream.replace(/\/$/, "");
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(payload));
    };
    void (async () => {
      const path = req.url?.split("?")[0];
      if (req.method !== "GET" && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        throw new HttpError(403, "Cross-origin requests are not allowed.");
      }
      if (path === "/config") {
        return send(200, await keyConfig(req, store, async (key) => {
          const check = await fetchImpl(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}`, "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) })
            .catch(() => { throw new HttpError(502, "Could not reach TypeSafe to check the key. Please retry."); });
          if (check.status === 401 || check.status === 403) throw new HttpError(400, "TypeSafe didn't accept that key. Check it and try again.");
          if (!check.ok) throw new HttpError(502, `TypeSafe couldn't check the key (HTTP ${check.status}). Please retry.`);
        }));
      }
      if (path !== "/v1/systemone") throw new HttpError(404, "Not found.");
      if (req.method !== "POST") throw new HttpError(405, "Use POST.");
      const { key } = await store.key();
      if (!key) throw new HttpError(503, "Add your TypeSafe API key in Settings → Library.");
      const upstreamResponse = await fetchImpl(`${base}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": USER_AGENT },
        body: new Uint8Array(await body(req)),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => { throw new HttpError(502, "Could not reach TypeSafe. Please retry."); });
      res.writeHead(upstreamResponse.status, { "content-type": upstreamResponse.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("Jev request failed:", error);
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : "Categorizing failed. Please retry." } });
    });
  };
}

export function jev(env: Record<string, string>): Plugin {
  // Saved beside the shared library, like the OpenCode key.
  const store = new LlmKeyStore(resolve(env.LIBRARY_DATA_DIR || ".readaloud-library"), env.TYPESAFE_API_KEY || "", "typesafe.json");
  const middleware = jevMiddleware(store, env.TYPESAFE_URL || "https://api.typesafe.ai");
  return {
    name: "readaloud:jev",
    configureServer(server) { server.middlewares.use("/api/jev", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/jev", middleware); },
  };
}
