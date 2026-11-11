import { Capacitor } from "@capacitor/core";

/** True inside the Capacitor iOS shell. False in a browser, and in unit tests. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Whether a page at this protocol was served by a web server (and not from files inside the app). */
export const servedByServer = (protocol: string) => protocol === "https:" || protocol === "http:";

/**
 * True when the iOS shell runs the files copied into the app. Those have no
 * web server behind them, so this origin has no /api routes.
 *
 * False in a browser, and in a shell built to load the app from a ReadAloud
 * server (READALOUD_PUBLIC_URL): there the page is the deployed web app, with
 * the device plugins added.
 */
export function isBundledApp(): boolean {
  return isNativeApp() && !servedByServer(location.protocol);
}

/** Match the status-bar text to the theme. Light scheme uses dark text. */
export async function syncStatusBar(scheme: "dark" | "light", background: string): Promise<void> {
  if (!isNativeApp()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: scheme === "light" ? Style.Light : Style.Dark });
  await StatusBar.setBackgroundColor({ color: background });
}
