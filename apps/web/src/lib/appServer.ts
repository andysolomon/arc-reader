import { CapacitorHttp, type HttpOptions } from "@capacitor/core";
import { isNativeApp } from "./native";

export const DEFAULT_APP_SERVER = (import.meta.env.VITE_APP_SERVER as string | undefined)
  ?? (import.meta.env.VITE_LIBRARY_SERVER as string | undefined)
  ?? "https://omarchy.tail1b9428.ts.net:8449";

export function normalizeAppServer(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch { return ""; }
}

let server = normalizeAppServer(DEFAULT_APP_SERVER);
export const appServer = () => server;
export function setAppServer(value: string): void { server = normalizeAppServer(value); }

/** Only application API paths move to the remote server. Bundled assets stay local. */
export function appApiUrl(path: string): string {
  if (!isNativeApp() || !path.startsWith("/api/")) return path;
  if (!server) throw new Error("Add your website address in Settings → Arc Reader server to connect.");
  return `${server}${path}`;
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

async function nativeBody(body: RequestInit["body"], headers: Headers): Promise<Pick<HttpOptions, "data" | "dataType">> {
  if (body == null) return {};
  if (body instanceof FormData) {
    // Capacitor's native multipart contract retains filenames, repeated fields and binary bytes.
    const data: Record<string, string>[] = [];
    for (const [key, value] of body.entries()) {
      data.push(typeof value === "string" ? { key, value, type: "string" } : {
        key, value: await base64(value), type: "base64File", fileName: value.name,
        contentType: value.type || "application/octet-stream",
      });
    }
    headers.set("content-type", "multipart/form-data");
    return { data, dataType: "formData" };
  }
  if (body instanceof Blob) {
    if (!headers.has("content-type")) headers.set("content-type", body.type || "application/octet-stream");
    return { data: await base64(body), dataType: "file" };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return nativeBody(new Blob([new Uint8Array(bytes)]), headers);
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    return { data: body.toString() };
  }
  if (typeof body === "string") {
    // Native HTTP silently drops a body that has no content type; fetch defaults to text.
    if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    return { data: body };
  }
  throw new Error("This upload format is not supported. Choose a file to upload.");
}

/** Abort the caller promptly; Capacitor finishes an already-submitted HTTP operation natively. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** Native HTTP carries JSON, audio bytes, uploads and completed SSE responses without CORS. */
export async function serverFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = appApiUrl(path);
  if (!isNativeApp()) return fetch(url, init);
  const run = async () => {
    init?.signal?.throwIfAborted();
    const headers = new Headers(init?.headers);
    const body = await nativeBody(init?.body, headers);
    init?.signal?.throwIfAborted();
    const response = await CapacitorHttp.request({
      url, method: init?.method || "GET", headers: Object.fromEntries(headers), ...body,
      // Default native fetch decodes POST responses as UTF-8, corrupting MP3/WAV.
      // Request bytes explicitly, then reconstruct the standard Response interface.
      responseType: "arraybuffer", connectTimeout: 600_000, readTimeout: 600_000,
      disableRedirects: true,
    });
    const responseHeaders = new Headers(response.headers);
    const json = responseHeaders.get("content-type")?.toLowerCase().includes("application/json");
    const data = json ? JSON.stringify(response.data)
      : Uint8Array.from(atob(response.data || ""), (char) => char.charCodeAt(0));
    const empty = init?.method?.toUpperCase() === "HEAD" || [204, 205, 304].includes(response.status);
    const result = new Response(empty ? null : data, { status: response.status, headers: responseHeaders });
    Object.defineProperty(result, "url", { value: response.url || url });
    return result;
  };
  return abortable(run(), init?.signal);
}
