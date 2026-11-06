import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

/** What the browser may learn about the key: never the key itself. */
export interface LlmConfig {
  configured: boolean;
  source: "saved" | "env" | null;
  /** Last four characters, to tell keys apart */
  hint: string | null;
}

const MAX_BODY = 8 * 1024 * 1024;
const USER_AGENT = "readaloud/0.1";
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** An API key entered in Settings, saved on this server (mode 600). It overrides the key from the environment. */
export class LlmKeyStore {
  private file: string;
  constructor(private directory: string, private envKey = "", fileName = "llm.json") {
    this.file = resolve(directory, fileName);
  }
  async key(): Promise<{ key: string; source: LlmConfig["source"] }> {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8")) as { key?: unknown };
      if (typeof saved.key === "string" && saved.key) return { key: saved.key, source: "saved" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.envKey ? { key: this.envKey, source: "env" } : { key: "", source: null };
  }
  async config(): Promise<LlmConfig> {
    const { key, source } = await this.key();
    return { configured: !!key, source, hint: key ? key.slice(-4) : null };
  }
  async save(key: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ key }), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  remove = () => rm(this.file, { force: true });
}

export async function body(req: IncomingMessage): Promise<Buffer> {
  const buffers: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > MAX_BODY) throw new HttpError(413, "The text is too large to send.");
    buffers.push(Buffer.from(chunk));
  }
  return Buffer.concat(buffers);
}

/** GET, PUT (after `verify` accepts it), or DELETE a saved key. Answers with the config, never the key. */
export async function keyConfig(req: IncomingMessage, store: LlmKeyStore, verify: (key: string) => Promise<void>): Promise<LlmConfig> {
  if (req.method === "GET") return store.config();
  if (req.method === "DELETE") { await store.remove(); return store.config(); }
  if (req.method !== "PUT") throw new HttpError(405, "Use GET, PUT, or DELETE.");
  let key: unknown;
  try { key = (JSON.parse((await body(req)).toString("utf8")) as { key?: unknown }).key; }
  catch { throw new HttpError(400, "Invalid JSON."); }
  if (typeof key !== "string" || !key.trim() || key.trim().length > 500 || /\s/.test(key.trim())) throw new HttpError(400, "Paste the API key without spaces.");
  await verify(key.trim());
  await store.save(key.trim());
  return store.config();
}

/**
 * /api/llm: key settings and OpenAI-compatible chat completions (OpenCode Go by default).
 * Go asks clients to name themselves and send a stable x-opencode-session per conversation.
 */
export function llmMiddleware(store: LlmKeyStore, upstream: string, fetchImpl: typeof fetch = fetch): Connect.NextHandleFunction {
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
            .catch(() => { throw new HttpError(502, "Could not reach OpenCode to check the key. Please retry."); });
          if (check.status === 401 || check.status === 403) throw new HttpError(400, "OpenCode didn't accept that key. Check it and try again.");
          if (!check.ok) throw new HttpError(502, `OpenCode couldn't check the key (HTTP ${check.status}). Please retry.`);
        }));
      }
      if (path !== "/v1/chat/completions" && path !== "/v1/responses") throw new HttpError(404, "Not found.");
      if (req.method !== "POST") throw new HttpError(405, "Use POST.");
      const { key } = await store.key();
      if (!key) throw new HttpError(503, "Add your OpenCode Go API key in Settings → Summaries.");
      const session = req.headers["x-opencode-session"];
      const upstreamResponse = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": USER_AGENT,
          ...(typeof session === "string" && session.length <= 200 ? { "x-opencode-session": session } : {}),
        },
        body: new Uint8Array(await body(req)),
        signal: AbortSignal.timeout(300_000),
      }).catch(() => { throw new HttpError(502, "Could not reach OpenCode. Please retry."); });
      res.writeHead(upstreamResponse.status, { "content-type": upstreamResponse.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    })().catch((error) => {
      if (!(error instanceof HttpError)) console.error("LLM request failed:", error);
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : "The summary request failed. Please retry." } });
    });
  };
}

export function llm(env: Record<string, string>): Plugin {
  // Saved beside the shared library so Docker Compose keeps it in the library volume.
  const store = new LlmKeyStore(resolve(env.LIBRARY_DATA_DIR || ".readaloud-library"), env.LLM_API_KEY || "");
  const middleware = llmMiddleware(store, env.LLM_URL || "https://opencode.ai/zen/go");
  return {
    name: "readaloud:llm",
    configureServer(server) { server.middlewares.use("/api/llm", middleware); },
    configurePreviewServer(server) { server.middlewares.use("/api/llm", middleware); },
  };
}
