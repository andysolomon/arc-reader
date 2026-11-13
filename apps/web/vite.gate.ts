import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { PROBE_IMAGE } from "./vite.shell";

/**
 * Locks the app to people holding READALOUD_ACCESS_TOKEN when it is reached from the
 * public internet through Tailscale Funnel (deploy/kind/terraform/app/public-url.tf).
 *
 * Tailscale sets `Tailscale-Funnel-Request` on every request that came through Funnel,
 * replacing any value the client sent, and never on tailnet requests. So tailnet access
 * stays open as before, and only Funnel requests need the token. A Funnel request with
 * no token configured is always refused.
 *
 * Opening any page with `?access=<token>` stores a long-lived cookie and redirects to the
 * same page without the token. The iOS app starts at such an address (capacitor.config.ts),
 * so the phone never asks for it.
 */

export const FUNNEL_HEADER = "tailscale-funnel-request";
export const ACCESS_PARAM = "access";
export const ACCESS_COOKIE = "readaloud_access";
/** The longest browsers keep a cookie. Each app start renews it. */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const digest = (value: string) => createHash("sha256").update(value).digest();
/** Constant-time string comparison. */
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function refuse(req: IncomingMessage, res: ServerResponse, path: string) {
  const message = "This ReadAloud is private. Open it from the ReadAloud app.";
  const json = path.startsWith("/api/");
  res.writeHead(401, { "content-type": json ? "application/json" : "text/html; charset=utf-8", "cache-control": "no-store" });
  if (req.method === "HEAD") return res.end();
  res.end(json
    ? JSON.stringify({ error: { message } })
    : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ReadAloud</title><p style="font:17px system-ui;margin:2em">${message}</p>`);
}

export function accessGate(token: string): Connect.NextHandleFunction {
  // The cookie holds a hash of the token, so the token itself is only ever sent once.
  const pass = token ? digest(`readaloud-access:${token}`).toString("base64url") : "";
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://gate");
    const offered = url.searchParams.get(ACCESS_PARAM);
    if (token && offered !== null && same(offered, token)) {
      res.setHeader("set-cookie", `${ACCESS_COOKIE}=${pass}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      if (req.method === "GET" || req.method === "HEAD") {
        url.searchParams.delete(ACCESS_PARAM);
        res.writeHead(303, { location: url.pathname + url.search, "cache-control": "no-store" });
        return res.end();
      }
      return next();
    }
    if (req.headers[FUNNEL_HEADER] === undefined) return next();
    // The iOS app's offline page loads this icon to learn that the server is up.
    if (url.pathname === PROBE_IMAGE) return next();
    const presented = cookie(req, ACCESS_COOKIE);
    if (pass && presented !== undefined && same(presented, pass)) return next();
    refuse(req, res, url.pathname);
  };
}

export function publicAccess(env: Record<string, string>): Plugin {
  const middleware = accessGate(env.READALOUD_ACCESS_TOKEN || "");
  return {
    name: "readaloud:public-access",
    // Before every other route, the speech proxy included.
    enforce: "pre",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
