import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { HttpError, LlmKeyStore, body, keyConfig } from "./vite.llm";

const USER_AGENT = "readaloud/0.1";
/** The only model this route pays for: Google's decision model, which hears audio. */
export const DECIDE_MODEL = "gemini-decision-1";
/** A 16 kHz mono WAV of a long passage, base64-encoded, plus ~150 questions. */
const MAX_DECIDE_BODY = 16 * 1024 * 1024;

interface DecideRequest { model?: unknown; state?: unknown; questions?: unknown }

/**
 * A System One request as Google's Decisions API takes it: `state` becomes `input`, and a
 * chat-style audio part becomes an inline audio block. Questions and answers share one format.
 */
export function googleRequest(request: DecideRequest) {
  const parts = typeof request.state === "string" ? [{ type: "text", text: request.state }] : request.state;
  if (!Array.isArray(parts) || !parts.length) throw new HttpError(400, "The request has nothing to judge.");
  const input = parts.map((part: { type?: unknown; text?: unknown; input_audio?: { data?: unknown; format?: unknown } }) => {
    if (part?.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
    const audio = part?.type === "input_audio" ? part.input_audio : undefined;
    if (audio && typeof audio.data === "string" && typeof audio.format === "string" && /^[a-z0-9]+$/.test(audio.format)) {
      return { type: "audio", data: audio.data, mime_type: `audio/${audio.format}` };
    }
    throw new HttpError(400, "Only text and audio can be judged.");
  });
  return { model: DECIDE_MODEL, input, questions: request.questions };
}

/**
 * /api/decide: Reading Practice's judge, Gemini Decision 1. With a Gemini API key (entered in
 * Settings → Practice and saved as gemini.json, else GEMINI_API_KEY) requests go straight to
 * Google's Decisions API. Without one they go to OpenCode's System One endpoint with the OpenCode
 * key the summaries use, which bills them to pay-as-you-go credits. Keys stay on this server, and
 * no other model can be asked through here.
 */
export function decideMiddleware(
  keys: { gemini: LlmKeyStore; opencode: LlmKeyStore },
  upstream: { google: string; opencode: string },
  fetchImpl: typeof fetch = fetch,
): Connect.NextHandleFunction {
  const google = upstream.google.replace(/\/$/, ""), opencode = upstream.opencode.replace(/\/$/, "");
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
        return send(200, await keyConfig(req, keys.gemini, async (key) => {
          const check = await fetchImpl(`${google}/models/${DECIDE_MODEL}`, { headers: { "x-goog-api-key": key, "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) })
            .catch(() => { throw new HttpError(502, "Could not reach Google to check the key. Please retry."); });
          if (check.status === 400 || check.status === 401 || check.status === 403) throw new HttpError(400, "Google didn't accept that key. Check it and try again.");
          if (check.status === 404) throw new HttpError(400, "That key can't use Gemini Decision 1 yet.");
          if (!check.ok) throw new HttpError(502, `Google couldn't check the key (HTTP ${check.status}). Please retry.`);
        }));
      }
      if (path !== "/v1/systemone") throw new HttpError(404, "Not found.");
      if (req.method !== "POST") throw new HttpError(405, "Use POST.");
      const raw = await body(req, MAX_DECIDE_BODY, "The recording is too large to send. Try a shorter reading.");
      let request: DecideRequest;
      try { request = JSON.parse(raw.toString("utf8")) as DecideRequest; }
      catch { throw new HttpError(400, "Invalid JSON."); }
      if (!request || typeof request !== "object" || request.model !== DECIDE_MODEL) throw new HttpError(400, `Only ${DECIDE_MODEL} can be asked here.`);
      const gemini = (await keys.gemini.key()).key;
      const fallback = gemini ? "" : (await keys.opencode.key()).key;
      if (!gemini && !fallback) throw new HttpError(503, "Add a Gemini API key in Settings → Practice to check readings.");
      const upstreamResponse = await (gemini
        ? fetchImpl(`${google}/decisions`, {
          method: "POST",
          headers: { "x-goog-api-key": gemini, "content-type": "application/json", "user-agent": USER_AGENT },
          body: JSON.stringify(googleRequest(request)),
          signal: AbortSignal.timeout(90_000),
        })
        : fetchImpl(`${opencode}/systemone`, {
          method: "POST",
          headers: { authorization: `Bearer ${fallback}`, "content-type": "application/json", "user-agent": USER_AGENT },
          body: new Uint8Array(raw),
          signal: AbortSignal.timeout(90_000),
        })
      ).catch(() => { throw new HttpError(502, `Could not reach ${gemini ? "Google" : "OpenCode"} to check the reading. Please retry.`); });
      res.writeHead(upstreamResponse.status, { "content-type": upstreamResponse.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("Decide request failed:", error);
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : "Checking the reading failed. Please retry." } });
    });
  };
}

export function decide(env: Record<string, string>): Plugin {
  const directory = resolve(env.LIBRARY_DATA_DIR || ".readaloud-library");
  const middleware = decideMiddleware(
    // The OpenCode store is the same key file as /api/llm.
    { gemini: new LlmKeyStore(directory, env.GEMINI_API_KEY || "", "gemini.json"), opencode: new LlmKeyStore(directory, env.LLM_API_KEY || "") },
    { google: env.GEMINI_URL || "https://generativelanguage.googleapis.com/v1beta", opencode: env.DECIDE_URL || "https://opencode.ai/inference/systemone/v1" },
  );
  return {
    name: "readaloud:decide",
    configureServer(server) { server.middlewares.use("/api/decide", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/decide", middleware); },
  };
}
