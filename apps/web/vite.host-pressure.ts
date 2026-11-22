import { readFile } from "node:fs/promises";

/** The most steps background preparation can be held back, beyond any machine's slots. */
const MAX_STEPS = 8;

/**
 * How hard other work is pushing on the CPU of the computer this server shares with its local
 * speech servers, from Linux pressure stall information (PSI). While other programs wait for
 * the CPU, background preparation there gives up one passage slot per check; once they stop
 * waiting it takes one back. Between the two thresholds it holds, so it does not flap.
 *
 * `some avg10` is the share of the last ten seconds in which something waited. On a 12-thread
 * laptop it stays near 0 with 6 busy threads, about 2 with 12, and about 20 with 16, so it
 * only rises once the CPU is oversubscribed. Without PSI (macOS, older kernels) nothing is held.
 */
export class HostPressure {
  private steps = 0;
  private next = 0;
  private reading?: Promise<void>;

  constructor(private file = "/proc/pressure/cpu", private high = 10, private low = 2, private intervalMs = 10_000) {}

  static from(env: Record<string, string>) {
    return new HostPressure(env.PREPARATION_PRESSURE_FILE || "/proc/pressure/cpu",
      Number(env.PREPARATION_PRESSURE_HIGH) || 10, Number(env.PREPARATION_PRESSURE_LOW) || 2,
      Number(env.PREPARATION_PRESSURE_INTERVAL_MS) || 10_000);
  }

  /** How many of a machine's `slots` background preparation may use now. */
  async allowed(slots: number): Promise<number> {
    if (Date.now() >= this.next) this.reading ??= this.read().finally(() => { this.reading = undefined; });
    await this.reading;
    return Math.max(0, slots - this.steps);
  }

  /** Milliseconds until the next check, which may change the answer. */
  get retryMs() {
    return Math.max(50, this.next - Date.now());
  }

  private async read() {
    this.next = Date.now() + this.intervalMs;
    const text = await readFile(this.file, "utf8").catch(() => "");
    const waiting = Number(/^some avg10=([\d.]+)/m.exec(text)?.[1]);
    if (!Number.isFinite(waiting)) this.steps = 0;
    else if (waiting > this.high) this.steps = Math.min(MAX_STEPS, this.steps + 1);
    else if (waiting < this.low && this.steps) this.steps--;
  }
}
