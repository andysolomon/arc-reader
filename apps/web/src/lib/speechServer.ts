/**
 * Where speech requests go.
 *
 * The web build talks to the same-origin Vite proxy (`/api/vs`), which holds
 * the VoiceStudio key. The iOS bundle has no proxy: a relative base is ignored
 * and the on-device voice reads instead, unless Settings stores an absolute
 * server (a ReadAloud proxy such as `https://host.ts.net:8449/api/vs`, or
 * VoiceStudio itself at `https://mac.ts.net:3900`).
 */

export interface SpeechEndpoint {
  /** Absolute http(s) API root, or empty. */
  override: string;
  /** Sent only with absolute requests. Empty means the proxy holds the key. */
  key: string;
}

let current: SpeechEndpoint = { override: "", key: "" };

export function setSpeechEndpoint(next: SpeechEndpoint): void {
  current = { override: normalizeSpeechServer(next.override), key: next.key.trim() };
}

export function speechEndpoint(): SpeechEndpoint {
  return current;
}

/** Accept only absolute http(s) URLs. Anything else is treated as unset. */
export function normalizeSpeechServer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * The base a speech client should call.
 * An absolute override wins. On the native shell, a relative build-time base
 * (the Vite proxy) is not a server, so it becomes empty.
 */
export function resolveApiBase(configured: string, native: boolean, override = ""): string {
  const custom = normalizeSpeechServer(override);
  if (custom) return custom;
  const base = configured.replace(/\/$/, "");
  if (native && base.startsWith("/")) return "";
  return base;
}

/** Attach the device-held key only when the request leaves the device. */
export function withSpeechAuth(url: string, init: RequestInit = {}): RequestInit {
  const key = current.key;
  if (!key || !/^https?:\/\//i.test(url)) return init;
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${key}`);
  return { ...init, headers };
}
