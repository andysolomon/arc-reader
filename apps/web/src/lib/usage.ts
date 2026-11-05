import { monthKey } from "./dates";

const KEY = "readaloud:usage";

interface Usage {
  month: string;
  chars: number;
  /** characters per engine id */
  byEngine: Record<string, number>;
}

function read(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Usage> | null;
    if (u && u.month === monthKey()) return { month: u.month, chars: u.chars ?? 0, byEngine: u.byEngine ?? {} };
  } catch {
    /* ignore */
  }
  return { month: monthKey(), chars: 0, byEngine: {} };
}

export function getUsage(): number {
  return read().chars;
}

export function getUsageByEngine(): Record<string, number> {
  return read().byEngine;
}

export function addUsage(chars: number, engine = "unknown") {
  const u = read();
  u.chars += chars;
  u.byEngine[engine] = (u.byEngine[engine] ?? 0) + chars;
  localStorage.setItem(KEY, JSON.stringify(u));
  window.dispatchEvent(new CustomEvent("readaloud:usage"));
}

export const PLAN_LIMIT = Number(import.meta.env.VITE_PLAN_LIMIT) || 1_000_000;

/** Published list prices, USD per million characters (text in). Audio-output charges for gpt-4o-mini-tts are not included. */
export const OPENAI_PRICE_PER_M: Record<string, number> = { "gpt-4o-mini-tts": 0.6, "tts-1": 15, "tts-1-hd": 30 };
