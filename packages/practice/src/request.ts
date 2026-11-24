/**
 * The one way the apps make a network request. A request with no deadline hangs forever on a
 * phone that sleeps or a tunnel that stalls: 20 clip saves that never answered once held every
 * place in the preparation queue (179a031). `timeoutMs` is required so no call can leave it out.
 */
export interface RequestOptions extends RequestInit {
  /** Give up after this long, reading the body included. A caller's `signal` can still stop it sooner. */
  timeoutMs: number;
}

/** `fetch` with a deadline. Past it, the request and any read of its body reject with a "TimeoutError" DOMException. */
export function request(url: string | URL, { timeoutMs, signal, ...init }: RequestOptions): Promise<Response> {
  const deadline = new AbortController();
  // A plain timer rather than AbortSignal.timeout, so tests with fake timers can run out the clock.
  const timer = setTimeout(() => deadline.abort(new DOMException("The server did not answer in time.", "TimeoutError")), timeoutMs);
  // A script run under Node exits without waiting for the deadline of a request that already finished.
  (timer as unknown as { unref?: () => void }).unref?.();
  return fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal });
}
