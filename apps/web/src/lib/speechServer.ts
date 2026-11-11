/**
 * Where speech requests go.
 *
 * The web build uses its Vite proxy; native clients use the selected app
 * server's proxy. An optional absolute VoiceStudio override takes precedence
 * for that provider alone. The other providers retain their app-server routes.
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

/** A VoiceStudio key belongs only to its configured endpoint, never the app's other proxies. */
export function withSpeechAuth(url: string, init: RequestInit = {}): RequestInit {
  const key = current.key;
  const base = current.override;
  if (!key || !base || !(url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`))) return init;
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${key}`);
  return { ...init, headers };
}
