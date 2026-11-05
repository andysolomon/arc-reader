import type { ProxyOptions } from "vite";
import { isSpeechRequest, type SpeechActivity } from "./vite.speech-activity";

/**
 * Forwards /api/vs/* to a VoiceStudio server and injects its API key.
 * Used by both `vite` and `vite preview`, so the browser never sees the key and
 * VoiceStudio only ever hears from the proxy. Browser Origin/Referer headers are
 * dropped: VoiceStudio's CSRF guard would reject an unknown origin, and a request
 * without one is treated as a non-browser client, which is what the proxy is.
 */
function route(prefix: string, target: string, key: string, extra: Partial<ProxyOptions> = {}, activity?: SpeechActivity): ProxyOptions {
  return {
      target,
      changeOrigin: true,
      rewrite: (p) => p.slice(prefix.length),
      timeout: 1_800_000,
      proxyTimeout: 1_800_000,
      configure(proxy) {
        proxy.on("proxyReq", (proxyReq, req, res) => {
          proxyReq.removeHeader("origin");
          proxyReq.removeHeader("referer");
          proxyReq.removeHeader("cookie");
          if (key) proxyReq.setHeader("authorization", `Bearer ${key}`);
          // Background preparation pauses while this live request is in flight.
          if (activity && isSpeechRequest(req?.method, req?.url)) res?.once("close", activity.begin(target));
        });
        proxy.on("error", (err, _req, res) => {
          if ("writeHead" in res && !res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "upstream_unreachable", message: err.message }));
          }
        });
      },
      ...extra,
  };
}

/**
 * /api/vs → VoiceStudio (loopback), /api/oa → OpenAI. Keys come from server-side env only.
 * `activity` is shared with audio preparation so it yields to live speech on the same server.
 */
export function voiceStudioProxy(env: Record<string, string>, activity?: SpeechActivity): Record<string, ProxyOptions> {
  const routes: Record<string, ProxyOptions> = {
    "/api/vs": route("/api/vs", (env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/$/, ""), env.VOICESTUDIO_API_KEY || "", {}, activity),
  };
  if (env.OPENAI_API_KEY) {
    routes["/api/oa"] = route("/api/oa", (env.OPENAI_URL || "https://api.openai.com").replace(/\/$/, ""), env.OPENAI_API_KEY, { secure: true });
  }
  if (env.FISH_API_KEY) {
    routes["^/api/fish(?:/|$)"] = route("/api/fish", "https://api.fish.audio", env.FISH_API_KEY, {
      secure: true,
      // Only expose the read-only voice catalogue and speech generation.
      bypass(req, res) {
        const path = new URL(req.url || "/", "http://localhost").pathname;
        const allowed = (req.method === "GET" && /^\/api\/fish\/model(?:\/[a-zA-Z0-9_-]+)?$/.test(path))
          || (req.method === "POST" && path === "/api/fish/v1/tts");
        if (!allowed) {
          return false;
        }
      },
    });
  }
  return routes;
}
