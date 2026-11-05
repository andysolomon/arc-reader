import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addUsage, formatUsd, getUsageSnapshot, priceUsage, summarizeUsage, USAGE_KEY } from "./usage";

const request = { engine: "fish", model: "s2.1-pro", text: "Hello", audioSeconds: 2 };
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, clear: () => values.clear() };
beforeEach(() => { vi.stubGlobal("localStorage", storage); vi.stubGlobal("navigator", {}); storage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("usage ledger", () => {
  it("counts UTF-8 bytes for Fish, including non-ASCII text", async () => {
    await addUsage({ ...request, text: "Aé猫😀" });
    const [row] = getUsageSnapshot().rows;
    expect(row).toMatchObject({ characters: 4, bytes: 10, requests: 1, inputTokens: null, outputTokens: null });
    expect(row.costUsd).toBeCloseTo(0.00015, 8);
  });

  it("prices reported input and output tokens independently", async () => {
    await addUsage({ ...request, engine: "openai", model: "gpt-4o-mini-tts", tokens: { inputTokens: 1000, outputTokens: 2000 } });
    expect(getUsageSnapshot().rows[0].costUsd).toBeCloseTo(0.0246, 8);
    expect(summarizeUsage(getUsageSnapshot().rows)).toMatchObject({ inputTokens: 1000, outputTokens: 2000, tokenRequests: 1, unpriced: false });
  });

  it("does not invent tokens or prices when the response or model is unknown", async () => {
    await addUsage({ ...request, engine: "openai", model: "gpt-4o-mini-tts" });
    await addUsage({ ...request, model: "custom" });
    await addUsage({ ...request, engine: "kittentts", model: "kittentts" });
    expect(getUsageSnapshot().rows.every((r) => r.costUsd === null && r.inputTokens === null)).toBe(true);
    expect(summarizeUsage(getUsageSnapshot().rows)).toMatchObject({ unpriced: true, priced: false });
  });

  it("distinguishes free pricing from unavailable pricing and character billing", () => {
    expect(priceUsage("fish", "s2.1-pro-free", 100, 200).costUsd).toBe(0);
    expect(priceUsage("openai", "tts-1", 100, 200).costUsd).toBeCloseTo(0.0015);
    expect(priceUsage("openai", "tts-1-hd", 100, 200).costUsd).toBeCloseTo(0.003);
    expect(priceUsage("openai", "future-model", 100, 200).costUsd).toBeNull();
  });

  it("accumulates concurrent requests and retains days, months and models", async () => {
    await Promise.all(Array.from({ length: 12 }, () => addUsage(request)));
    expect(getUsageSnapshot().rows).toHaveLength(1);
    expect(getUsageSnapshot().rows[0].requests).toBe(12);
    vi.setSystemTime(new Date(2026, 10, 6, 12));
    await addUsage(request);
    vi.setSystemTime(new Date(2026, 11, 1, 12));
    await addUsage({ ...request, model: "s2-pro" });
    const rows = getUsageSnapshot().rows;
    expect(rows.map((r) => r.day)).toEqual(["2026-11-05", "2026-11-06", "2026-12-01"]);
    expect(rows[2].model).toBe("s2-pro");
    expect(summarizeUsage(rows).requests).toBe(14);
    expect(summarizeUsage(rows).costUsd).toBeCloseTo(14 * 5 * 15 / 1e6);
  });

  it("uses the cross-tab lock for atomic writes", async () => {
    const lock = vi.fn(async (_key: string, callback: () => void) => callback());
    vi.stubGlobal("navigator", { locks: { request: lock } });
    await addUsage(request);
    expect(lock).toHaveBeenCalledWith(USAGE_KEY, expect.any(Function));
    expect(getUsageSnapshot().rows[0].requests).toBe(1);
  });

  it("preserves legacy totals once, without fabricating models or costs", async () => {
    localStorage.setItem(USAGE_KEY, JSON.stringify({ month: "2026-10", chars: 1000, byEngine: { openai: 500, fish: 300 } }));
    expect(summarizeUsage(getUsageSnapshot().rows)).toMatchObject({ characters: 1000, requests: 0, legacy: true, unpriced: true });
    await addUsage(request);
    await addUsage(request);
    const rows = getUsageSnapshot().rows;
    expect(rows.filter((r) => r.day === "2026-10")).toHaveLength(3);
    expect(rows.filter((r) => r.legacy).every((r) => r.costUsd === null && r.inputTokens === null)).toBe(true);
    expect(summarizeUsage(rows)).toMatchObject({ characters: 1010, requests: 2, priced: true, unpriced: true });
  });

  it("keeps historical cost when the model or current prices change", async () => {
    await addUsage(request);
    const saved = JSON.parse(localStorage.getItem(USAGE_KEY)!);
    saved.rows[0].costUsd = 1.25;
    saved.rows[0].pricing = "Earlier rate";
    localStorage.setItem(USAGE_KEY, JSON.stringify(saved));
    await addUsage(request);
    expect(getUsageSnapshot().rows).toHaveLength(2);
    expect(getUsageSnapshot().rows[0].costUsd).toBe(1.25);
  });

  it("handles malformed data and storage denial without breaking speech", async () => {
    localStorage.setItem(USAGE_KEY, "{broken");
    expect(getUsageSnapshot()).toEqual({ rows: [], storageError: true });
    localStorage.clear();
    const spy = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    await expect(addUsage(request)).resolves.toBeUndefined();
    expect(getUsageSnapshot().storageError).toBe(true);
    spy.mockRestore();
    await addUsage(request);
    expect(getUsageSnapshot().storageError).toBe(false);
    expect(getUsageSnapshot().rows[0].requests).toBe(1);
  });

  it("filters corrupt rows and keeps valid ones", async () => {
    await addUsage(request);
    const ledger = JSON.parse(localStorage.getItem(USAGE_KEY)!);
    ledger.rows.push(null, { ...ledger.rows[0], costUsd: -10 }, { ...ledger.rows[0], requests: "3" });
    localStorage.setItem(USAGE_KEY, JSON.stringify(ledger));
    expect(getUsageSnapshot().rows).toHaveLength(1);
    expect(getUsageSnapshot().storageError).toBe(true);
  });

  it("retains small amounts without rounding a nonzero spend to zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00001)).toBe("<$0.0001");
    expect(formatUsd(0.0015)).toBe("$0.0015");
  });
});
