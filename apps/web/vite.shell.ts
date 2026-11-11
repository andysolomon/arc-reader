import type { Plugin } from "vite";

/**
 * The page the iOS shell shows when it loads the app from a server
 * (READALOUD_PUBLIC_URL, see capacitor.config.ts) and that server cannot be
 * reached. It ships inside the app, so it works with no network, and it is
 * built only when a server is configured.
 */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small file every build of the web app serves. The page loads it to learn that the app is up. */
export const PROBE_IMAGE = "/icons/icon-192.png";

/** How often the page checks for the server, and how long one attempt may take. */
const TIMING = { retryMs: 4000, giveUpMs: 10000 };

/** Colors are the dark theme's (packages/tokens): the shell paints that behind the web view. */
export function unreachablePage(serverUrl: string, timing = TIMING): string {
  const host = escapeHtml(new URL(serverUrl).host);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ReadAloud</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    box-sizing: border-box;
    padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
    background: #161412; color: #ece6dc; text-align: center;
    font: 17px/1.45 -apple-system, system-ui, sans-serif; -webkit-text-size-adjust: 100%;
  }
  h1 { margin: 0; font-size: 22px; font-weight: 600; }
  p { margin: 0; max-width: 30ch; color: #a39a8e; }
  .host { color: #ece6dc; overflow-wrap: anywhere; }
  button {
    margin-top: 12px; min-height: 48px; padding: 0 28px; border: 0; border-radius: 999px;
    background: #d9955a; color: #1c120a; font: inherit; font-weight: 600;
  }
  button:disabled { opacity: 0.6; }
</style>
</head>
<body>
<h1>Can’t reach ReadAloud</h1>
<p>The app loads from <span class="host">${host}</span>. Check that Tailscale is connected on this iPhone. It opens by itself once the server answers.</p>
<button type="button" id="retry">Try again</button>
<script>
  var server = ${JSON.stringify(serverUrl).replace(/</g, "\\u003c")};
  var button = document.getElementById("retry");
  var leaving = false, checking = false, next = 0;

  // Open the app. A stale connection can hang for a minute before the web view
  // gives up, so stop waiting after a while and offer the button again.
  function openApp() {
    if (leaving) return;
    leaving = true;
    button.disabled = true;
    button.textContent = "Connecting…";
    location.replace(server);
    setTimeout(function () {
      window.stop();
      leaving = false;
      button.disabled = false;
      button.textContent = "Try again";
      schedule();
    }, ${timing.giveUpMs});
  }
  button.addEventListener("click", openApp);

  // Keep checking in the background, so reconnecting Tailscale is enough. The
  // image loads only when the app itself is being served, which a server that
  // is restarting for a deploy does not do.
  function check() {
    if (leaving || checking || document.hidden) return;
    checking = true;
    var image = new Image(), settled = false;
    var settle = function (reachable) {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      checking = false;
      if (leaving) return;
      if (reachable) openApp();
      else schedule();
    };
    var limit = setTimeout(function () { settle(false); image.src = ""; }, ${timing.giveUpMs});
    image.onload = function () { settle(true); };
    image.onerror = function () { settle(false); };
    image.src = server + ${JSON.stringify(PROBE_IMAGE)} + "?" + Date.now();
  }
  function schedule() {
    clearTimeout(next);
    next = setTimeout(check, ${timing.retryMs});
  }

  // Coming back from Settings or the Tailscale app, or regaining a network.
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  check();
</script>
</body>
</html>
`;
}

export function shellFallback(serverUrl: string, fileName: string): Plugin {
  return {
    name: "readaloud:shell-fallback",
    apply: "build",
    generateBundle() {
      if (serverUrl) this.emitFile({ type: "asset", fileName, source: unreachablePage(serverUrl) });
    },
  };
}
