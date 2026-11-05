import type { ProxyOptions } from "vite";

/**
 * Forwards /api/vs/* to a VoiceStudio server and injects its API key.
 * Used by both `vite` and `vite preview`, so the browser never sees the key and
 * VoiceStudio only ever hears from loopback. Browser Origin/Referer headers are
 * dropped: VoiceStudio's CSRF guard would reject an unknown origin, and a request
 * without one is treated as a non-browser client, which is what the proxy is.
 */
function route(prefix: string, target: string, key: string, extra: Partial<ProxyOptions> = {}): ProxyOptions {
  return {
      target,
      changeOrigin: true,
      rewrite: (p) => p.slice(prefix.length),
      timeout: 1_800_000,
      proxyTimeout: 1_800_000,
      configure(proxy) {
        proxy.on("proxyReq", (req) => {
          req.removeHeader("origin");
          req.removeHeader("referer");
          req.removeHeader("cookie");
          if (key) req.setHeader("authorization", `Bearer ${key}`);
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

/** /api/vs → VoiceStudio (loopback), /api/oa → OpenAI. Keys come from server-side env only. */
export function voiceStudioProxy(env: Record<string, string>): Record<string, ProxyOptions> {
  const routes: Record<string, ProxyOptions> = {
    "/api/vs": route("/api/vs", (env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/$/, ""), env.VOICESTUDIO_API_KEY || ""),
  };
  if (env.OPENAI_API_KEY) {
    routes["/api/oa"] = route("/api/oa", (env.OPENAI_URL || "https://api.openai.com").replace(/\/$/, ""), env.OPENAI_API_KEY, { secure: true });
  }
  return routes;
}
