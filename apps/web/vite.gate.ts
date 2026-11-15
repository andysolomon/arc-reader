import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

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
 *
 * Cadence's server (apps/cadence) uses this file too, so it imports nothing from this app's
 * own packages.
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

export interface GateOptions {
  /** Paths anyone may load, token or not. */
  open?: string[];
  /** Shown on the refusal page. */
  app?: string;
  message?: string;
  /**
   * Redirect to the token-free address with a relative Location, for an app that is also reached
   * under a path prefix it never sees (Cadence at /cadence/).
   */
  relativeRedirect?: boolean;
}

function refuse(req: IncomingMessage, res: ServerResponse, path: string, { app = "ReadAloud", message = "This ReadAloud is private. Open it from the ReadAloud app." }: GateOptions) {
  const json = path.startsWith("/api/");
  res.writeHead(401, { "content-type": json ? "application/json" : "text/html; charset=utf-8", "cache-control": "no-store" });
  if (req.method === "HEAD") return res.end();
  res.end(json
    ? JSON.stringify({ error: { message } })
    : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${app}</title><p style="font:17px system-ui;margin:2em">${message}</p>`);
}

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function accessGate(token: string, options: GateOptions = {}): Middleware {
  // The cookie holds a hash of the token, so the token itself is only ever sent once.
  const pass = token ? digest(`readaloud-access:${token}`).toString("base64url") : "";
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://gate");
    const offered = url.searchParams.get(ACCESS_PARAM);
    if (token && offered !== null && same(offered, token)) {
      res.setHeader("set-cookie", `${ACCESS_COOKIE}=${pass}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      if (req.method === "GET" || req.method === "HEAD") {
        url.searchParams.delete(ACCESS_PARAM);
        // Relative: the last path segment, which the browser resolves against the address it asked for.
        const location = options.relativeRedirect ? `${url.pathname.slice(url.pathname.lastIndexOf("/") + 1) || "./"}${url.search}` : url.pathname + url.search;
        res.writeHead(303, { location, "cache-control": "no-store" });
        return res.end();
      }
      return next();
    }
    if (req.headers[FUNNEL_HEADER] === undefined) return next();
    if (options.open?.includes(url.pathname)) return next();
    const presented = cookie(req, ACCESS_COOKIE);
    if (pass && presented !== undefined && same(presented, pass)) return next();
    refuse(req, res, url.pathname, options);
  };
}

/** A Vite plugin, typed by its shape so this file needs no Vite of its own. */
export function publicAccess(env: Record<string, string>, options: GateOptions = {}) {
  const middleware = accessGate(env.READALOUD_ACCESS_TOKEN || "", options);
  return {
    name: "readaloud:public-access",
    // Before every other route, the speech proxy included.
    enforce: "pre" as const,
    configureServer(server: { middlewares: { use(fn: Middleware): unknown } }) { server.middlewares.use(middleware); },
    configurePreviewServer(server: { middlewares: { use(fn: Middleware): unknown } }) { server.middlewares.use(middleware); },
  };
}
