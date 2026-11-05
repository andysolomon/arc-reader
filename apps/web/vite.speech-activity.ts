/**
 * Live speech requests (a reader listening, a voice preview) and background
 * preparation share one VoiceStudio, which runs a single GPU worker and queues
 * at most one more request. Preparation yields while anyone is listening so
 * live requests are never refused as "pool saturated", and so two engines do
 * not keep evicting each other from memory.
 */
export class SpeechActivity {
  private inflight = new Map<string, number>();
  private lastEnd = new Map<string, number>();
  private waiters = new Set<() => void>();

  constructor(private graceMs = 15_000) {}

  /** Marks a live request on `target`; call the returned function exactly once when it ends. */
  begin(target: string): () => void {
    const key = SpeechActivity.key(target);
    this.inflight.set(key, (this.inflight.get(key) || 0) + 1);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const left = (this.inflight.get(key) || 1) - 1;
      if (left > 0) this.inflight.set(key, left);
      else this.inflight.delete(key);
      this.lastEnd.set(key, Date.now());
      for (const wake of this.waiters) wake();
      this.waiters.clear();
    };
  }

  /** Milliseconds until `target` has been quiet for the grace period; 0 when it already is. */
  pending(target: string): number {
    const key = SpeechActivity.key(target);
    if (this.inflight.get(key)) return Infinity;
    const end = this.lastEnd.get(key);
    return end === undefined ? 0 : Math.max(0, end + this.graceMs - Date.now());
  }

  /** Resolves once `target` has been quiet for the grace period. */
  async idle(target: string): Promise<void> {
    for (;;) {
      const remaining = this.pending(target);
      if (remaining === 0) return;
      await new Promise<void>((resolve) => {
        if (remaining === Infinity) { this.waiters.add(resolve); return; }
        const timer = setTimeout(resolve, remaining);
        timer.unref?.();
      });
    }
  }

  static key(target: string) { return target.replace(/\/$/, ""); }
}

/** The OpenAI-style speech route, before or after the /api/vs prefix is rewritten away. */
export const isSpeechRequest = (method: string | undefined, url: string | undefined) =>
  method === "POST" && /^(?:\/api\/vs)?\/v1\/audio\/speech(?:[?#]|$)/.test(url || "");
