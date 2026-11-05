import { monthKey } from "./dates";

const KEY = "readaloud:usage";

interface Usage {
  month: string;
  chars: number;
}

function read(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? "null") as Usage | null;
    if (u && u.month === monthKey()) return u;
  } catch {
    /* ignore */
  }
  return { month: monthKey(), chars: 0 };
}

export function getUsage(): number {
  return read().chars;
}

export function addUsage(chars: number) {
  const u = read();
  u.chars += chars;
  localStorage.setItem(KEY, JSON.stringify(u));
  window.dispatchEvent(new CustomEvent("readaloud:usage"));
}

export const PLAN_LIMIT = Number(import.meta.env.VITE_PLAN_LIMIT) || 1_000_000;
