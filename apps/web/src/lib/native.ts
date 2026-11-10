import { Capacitor } from "@capacitor/core";

/** True inside the Capacitor iOS shell. False in a browser, and in unit tests. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Match the status-bar text to the theme. Light scheme uses dark text. */
export async function syncStatusBar(scheme: "dark" | "light", background: string): Promise<void> {
  if (!isNativeApp()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: scheme === "light" ? Style.Light : Style.Dark });
  await StatusBar.setBackgroundColor({ color: background });
}
