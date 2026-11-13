import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS shell around the web app. It runs in one of two ways, chosen when
 * `ios:sync` builds it:
 *
 * - READALOUD_PUBLIC_URL set: the web view loads the app from that ReadAloud
 *   server, so every deploy reaches the phone and the server's /api routes
 *   (speech proxy, shared library, preparation) are on the page's own origin.
 *   When the server cannot be reached, the bundled `unreachable.html` is shown.
 *   READALOUD_APP_URL, when set, is loaded instead: the public Tailscale Funnel
 *   address, which does not need Tailscale on the phone. READALOUD_ACCESS_TOKEN
 *   is then added to the start address so the server lets the phone in
 *   (vite.gate.ts).
 * - Unset: the web view loads the production bundle copied into the app
 *   (`webDir`), and never opens a remote page.
 */

/** The page shown when the server cannot be reached. vite.shell.ts builds it. */
export const UNREACHABLE_PAGE = "unreachable.html";

/** KEY=value lines of an env file. Missing files read as empty. */
function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** An absolute http(s) origin without a trailing slash, or empty. */
export function publicUrl(value: string | undefined, name = "READALOUD_PUBLIC_URL"): string {
  if (!value?.trim()) return "";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be http(s): ${value}`);
  return url.origin;
}

/** The address the web view opens: the server, with the access token when there is one. */
export function startAddress(server: string, token: string | undefined): string {
  return server && token ? `${server}/?access=${encodeURIComponent(token)}` : server;
}

// The environment wins, then the files the web build and the deploy read.
const setting = (name: string): string | undefined =>
  process.env[name] ?? envFile(resolve(".env.local"))[name] ?? envFile(resolve("../../.env"))[name];
const appUrl = setting("READALOUD_APP_URL");

/** The server the shell loads the app from. Empty means the bundled files. */
export const serverUrl = appUrl?.trim()
  ? publicUrl(appUrl, "READALOUD_APP_URL")
  : publicUrl(setting("READALOUD_PUBLIC_URL"));

/** Where the shell starts: serverUrl, carrying the token that unlocks public access. */
export const startUrl = startAddress(serverUrl, setting("READALOUD_ACCESS_TOKEN")?.trim());

const config: CapacitorConfig = {
  appId: "dev.andrewsolomon.arcreader",
  appName: "ReadAloud",
  webDir: "dist",
  // Shown behind the web view until the first paint. Matches the dark theme.
  backgroundColor: "#161412",
  ...(serverUrl && {
    server: {
      url: startUrl,
      errorPath: UNREACHABLE_PAGE,
      // Capacitor keeps a page in the web view only when its address starts with `url`
      // or its host is listed here, and hands anything else to Safari. With the access
      // token in `url`, the server's redirect to the same page without it would leave.
      allowNavigation: [new URL(serverUrl).hostname],
    },
  }),
  ios: {
    backgroundColor: "#161412",
    // The shell pads itself with env(safe-area-inset-*). Automatic insets
    // would pad twice and sit the reader below the status bar.
    contentInset: "never",
  },
  plugins: {
    // Bundled files have no server of their own: absolute speech-server
    // requests (Settings → Speech server) go through the native HTTP stack so a
    // tailnet VoiceStudio does not need CORS headers. Loaded from a server, the
    // page calls its own origin, and the native stack would buffer the
    // streamed speech responses.
    CapacitorHttp: {
      enabled: !serverUrl,
    },
    StatusBar: {
      overlaysWebView: true,
      // Light status-bar text on the dark background. Theme changes flip this
      // at runtime (see App.tsx).
      style: "DARK",
      backgroundColor: "#161412",
    },
  },
};

export default config;
