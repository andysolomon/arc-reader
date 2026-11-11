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
export function publicUrl(value: string | undefined): string {
  if (!value?.trim()) return "";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`READALOUD_PUBLIC_URL is not a URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`READALOUD_PUBLIC_URL must be http(s): ${value}`);
  return url.origin;
}

// The environment wins, then the files the web build and the deploy read.
const setting =
  process.env.READALOUD_PUBLIC_URL ??
  envFile(resolve(".env.local")).READALOUD_PUBLIC_URL ??
  envFile(resolve("../../.env")).READALOUD_PUBLIC_URL;

/** The server the shell loads the app from. Empty means the bundled files. */
export const serverUrl = publicUrl(setting);

const config: CapacitorConfig = {
  appId: "dev.andrewsolomon.arcreader",
  appName: "ReadAloud",
  webDir: "dist",
  // Shown behind the web view until the first paint. Matches the dark theme.
  backgroundColor: "#161412",
  ...(serverUrl && { server: { url: serverUrl, errorPath: UNREACHABLE_PAGE } }),
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
