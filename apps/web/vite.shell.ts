import type { Plugin } from "vite";

/**
 * The page the iOS shell shows when it loads the app from a server
 * (READALOUD_PUBLIC_URL, see capacitor.config.ts) and that server cannot be
 * reached. It ships inside the app, so it works with no network, and it is
 * built only when a server is configured.
 */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Colors are the dark theme's (packages/tokens): the shell paints that behind the web view. */
export function unreachablePage(serverUrl: string): string {
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
<p>The app loads from <span class="host">${host}</span>. Check that Tailscale is connected on this iPhone.</p>
<button type="button" id="retry">Try again</button>
<script>
  var server = ${JSON.stringify(serverUrl).replace(/</g, "\\u003c")};
  var button = document.getElementById("retry");
  function retry() {
    button.disabled = true;
    button.textContent = "Connecting…";
    location.replace(server);
  }
  button.addEventListener("click", retry);
  // Coming back from Settings or the Tailscale app, or regaining a network.
  document.addEventListener("visibilitychange", function () { if (!document.hidden) retry(); });
  window.addEventListener("online", retry);
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
