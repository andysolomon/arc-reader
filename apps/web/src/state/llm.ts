import { create } from "zustand";
import type { LlmConfig } from "../../vite.llm";

interface LlmState {
  /** null until loaded, or when this server has no /api/llm (static hosting) */
  config: LlmConfig | null;
  load: () => Promise<void>;
  /** The server checks the key with OpenCode before saving it. */
  save: (key: string) => Promise<void>;
  remove: () => Promise<void>;
}

async function request(init?: RequestInit): Promise<LlmConfig> {
  const response = await fetch("/api/llm/config", { ...init, headers: { "Content-Type": "application/json" } });
  const data = await response.json().catch(() => null) as (LlmConfig & { error?: { message?: string } }) | null;
  if (!response.ok || !data) throw new Error(data?.error?.message || `The server couldn't update the key (HTTP ${response.status}).`);
  return data;
}

export const useLlm = create<LlmState>()((set) => ({
  config: null,
  load: async () => {
    const config = await request().catch(() => null);
    if (config) set({ config });
  },
  save: async (key) => set({ config: await request({ method: "PUT", body: JSON.stringify({ key }) }) }),
  remove: async () => set({ config: await request({ method: "DELETE" }) }),
}));
