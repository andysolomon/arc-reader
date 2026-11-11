interface Activity { playing: boolean; loading: boolean; preparing: string | null }
interface ActivityStore { getState(): Activity; subscribe(listener: (state: Activity) => void): () => void }

const busy = (s: Activity) => s.playing || s.loading || !!s.preparing;

/**
 * A deploy activates a new service worker in every open tab. Reloading at once
 * cut readings off mid-passage (the reader came back paused), so wait until
 * nothing is playing, loading, or being prepared.
 */
export function reloadWhenIdle(store: ActivityStore, reload = () => location.reload()) {
  if (!busy(store.getState())) return reload();
  const unsubscribe = store.subscribe((state) => {
    if (busy(state)) return;
    unsubscribe();
    reload();
  });
}

/** The entry script a built index.html loads, e.g. "/assets/index-3fa9c1.js". Every build names it differently. */
export const entryScript = (html: string) => html.match(/<script type="module"[^>]*\ssrc="([^"]+)"/)?.[1] ?? null;

/** True when the server's page loads a different build from `running`. Unknown (offline, an error page) counts as no. */
export async function serverHasNewBuild(running: string | null, loadPage: () => Promise<string>): Promise<boolean> {
  if (!running) return false;
  try {
    const served = entryScript(await loadPage());
    return served !== null && served !== running;
  } catch {
    return false;
  }
}

/**
 * For the iOS shell that loads the app from the server. It has no service
 * worker to announce a deploy, and iOS keeps the page alive for days, so each
 * time the app comes to the foreground, ask the server which build it serves
 * and reload (once nothing is playing) when it has moved on.
 */
export function reloadOnNewBuild(store: ActivityStore) {
  const running = entryScript(document.head.innerHTML);
  let reloading = false;
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || reloading) return;
    const page = async () => (await fetch("/", { cache: "no-store" })).text();
    if (reloading || !(await serverHasNewBuild(running, page))) return;
    reloading = true;
    reloadWhenIdle(store);
  });
}

/** The query a reachability probe adds to "/", so tests can tell it from a page load. */
export const PROBE_QUERY = "reachable";

/**
 * True when the server answers within `timeoutMs`. A stale Tailscale tunnel
 * (common right after the phone changes networks) can leave a request hanging
 * for a minute, so give up early rather than wait.
 */
export async function serverReachable(timeoutMs = 5000, load: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await load(`/?${PROBE_QUERY}=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
