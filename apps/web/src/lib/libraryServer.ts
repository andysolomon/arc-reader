import { CapacitorHttp } from "@capacitor/core";
import { isNativeApp } from "./native";
import type { LibraryChange, LibrarySnapshot } from "./libraryProtocol";
import { appApiUrl } from "./appServer";

/** The existing shared library; builds for another server can override this. */
export { DEFAULT_APP_SERVER as DEFAULT_LIBRARY_SERVER, normalizeAppServer as normalizeLibraryServer, setAppServer as setLibraryServer } from "./appServer";

export function librarySyncUrl(): string {
  return appApiUrl("/api/library/sync");
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
    throw new Error("This address did not return a library. Use your website address in Settings → Arc Reader server.");
  }
  return snapshot;
}
