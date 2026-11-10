import { CapacitorHttp } from "@capacitor/core";
import { isNativeApp } from "./native";
import type { LibraryChange, LibrarySnapshot } from "./libraryProtocol";

/** The existing shared library; builds for another server can override this. */
export const DEFAULT_LIBRARY_SERVER = (import.meta.env.VITE_LIBRARY_SERVER as string | undefined)
  ?? "https://omarchy.tail1b9428.ts.net:8449";

/** Library settings accept the website's root address, not a speech API URL. */
export function normalizeLibraryServer(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

let server = normalizeLibraryServer(DEFAULT_LIBRARY_SERVER);

export function setLibraryServer(value: string): void {
  server = normalizeLibraryServer(value);
}

export function librarySyncUrl(): string {
  if (!isNativeApp()) return "/api/library/sync";
  if (!server) throw new Error("Add your Arc Reader website address in Settings → Library server to sync.");
  return `${server}/api/library/sync`;
}

export async function requestLibrarySync(url: string, changes: LibraryChange[]): Promise<LibrarySnapshot> {
  let status: number;
  let data: unknown;
  if (isNativeApp()) {
    // Native HTTP bypasses WKWebView's capacitor:// origin and browser CORS.
    // Never attach the speech-server key to the separate library connection.
    const response = await CapacitorHttp.post({
      url, headers: { "content-type": "application/json" }, data: { changes },
      responseType: "json", connectTimeout: 20_000, readTimeout: 20_000,
      disableRedirects: true,
    });
    status = response.status;
    data = response.data;
  } else {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    status = response.status;
    data = await response.json().catch(() => null);
  }
  if (status < 200 || status >= 300) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof message === "string" ? message : "Library server unavailable. Check the address in Settings and your connection.");
  }
  const snapshot = data as LibrarySnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.docs) || !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.deleted)) {
    throw new Error("This address did not return a library. Use your Arc Reader website address in Settings → Library server.");
  }
  return snapshot;
}
