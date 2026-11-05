import type { ProxyOptions } from "vite";

/**
 * Forwards /api/vs/* to a VoiceStudio server and injects its API key.
 * Used by both `vite` and `vite preview`, so the browser never sees the key and
 * VoiceStudio only ever hears from loopback. Browser Origin/Referer headers are
 * dropped: VoiceStudio's CSRF guard would reject an unknown origin, and a request
 * without one is treated as a non-browser client, which is what the proxy is.
 */
export function voiceStudioProxy(env: Record<string, string>): Record<string, ProxyOptions> {
  const target = (env.VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/$/, "");
  const key = env.VOICESTUDIO_API_KEY || "";
  return {
    "/api/vs": {
      target,
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api\/vs/, ""),
      timeout: 120_000,
      proxyTimeout: 120_000,
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
            res.end(JSON.stringify({ error: "voicestudio_unreachable", message: err.message }));
          }
        });
      },
    },
  };
}
