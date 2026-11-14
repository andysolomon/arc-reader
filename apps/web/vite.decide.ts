import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { HttpError, LlmKeyStore, body } from "./vite.llm";

const USER_AGENT = "readaloud/0.1";
/** The only model this route pays for: Google's decision model, which hears audio. */
export const DECIDE_MODEL = "gemini-decision-1";
/** A 16 kHz mono WAV of a long passage, base64-encoded, plus ~150 questions. */
const MAX_DECIDE_BODY = 16 * 1024 * 1024;

/**
 * /api/decide: Reading Practice's judge. Forwards System One requests for Gemini Decision 1 to
 * OpenCode with the OpenCode key the summaries already use (llm.json, else LLM_API_KEY). The key
 * stays on this server, and no other model can be asked through here.
 */
export function decideMiddleware(store: LlmKeyStore, upstream: string, fetchImpl: typeof fetch = fetch): Connect.NextHandleFunction {
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
        if (req.method !== "GET") throw new HttpError(405, "Use GET. The OpenCode key is set in Settings → Summaries.");
        return send(200, await store.config());
      }
      if (path !== "/v1/systemone") throw new HttpError(404, "Not found.");
      if (req.method !== "POST") throw new HttpError(405, "Use POST.");
      const raw = await body(req, MAX_DECIDE_BODY, "The recording is too large to send. Try a shorter reading.");
      let request: { model?: unknown };
      try { request = JSON.parse(raw.toString("utf8")) as { model?: unknown }; }
      catch { throw new HttpError(400, "Invalid JSON."); }
      if (!request || typeof request !== "object" || request.model !== DECIDE_MODEL) throw new HttpError(400, `Only ${DECIDE_MODEL} can be asked here.`);
      const { key } = await store.key();
      if (!key) throw new HttpError(503, "Add your OpenCode key in Settings → Summaries to check readings.");
      const upstreamResponse = await fetchImpl(`${base}/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": USER_AGENT },
        body: new Uint8Array(raw),
        signal: AbortSignal.timeout(90_000),
      }).catch(() => { throw new HttpError(502, "Could not reach OpenCode to check the reading. Please retry."); });
      res.writeHead(upstreamResponse.status, { "content-type": upstreamResponse.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("Decide request failed:", error);
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : "Checking the reading failed. Please retry." } });
    });
  };
}

export function decide(env: Record<string, string>): Plugin {
  // The same key file as /api/llm: one OpenCode key serves summaries and the reading judge.
  const store = new LlmKeyStore(resolve(env.LIBRARY_DATA_DIR || ".readaloud-library"), env.LLM_API_KEY || "");
  const middleware = decideMiddleware(store, env.DECIDE_URL || "https://opencode.ai/inference/systemone/v1");
  return {
    name: "readaloud:decide",
    configureServer(server) { server.middlewares.use("/api/decide", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/decide", middleware); },
  };
}
