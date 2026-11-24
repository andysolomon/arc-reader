import { request } from "@readaloud/practice/request";
import { create } from "zustand";
import type { LlmConfig } from "../../vite.llm";

export interface KeyState {
  /** null until loaded, or when this server has no such route (static hosting) */
  config: LlmConfig | null;
  load: () => Promise<void>;
  /** The server checks the key with the provider before saving it. */
  save: (key: string) => Promise<void>;
  remove: () => Promise<void>;
}

/** A provider key saved on this ReadAloud server; the browser only learns whether it is set. */
function keyStore(path: string) {
  async function send(init?: RequestInit): Promise<LlmConfig> {
    const response = await request(path, { ...init, headers: { "Content-Type": "application/json" }, timeoutMs: 30_000 });
    const data = await response.json().catch(() => null) as (LlmConfig & { error?: { message?: string } }) | null;
    if (!response.ok || !data) throw new Error(data?.error?.message || `The server couldn't update the key (HTTP ${response.status}).`);
    return data;
  }
  return create<KeyState>()((set) => ({
    config: null,
    load: async () => {
      const config = await send().catch(() => null);
      if (config) set({ config });
    },
    save: async (key) => set({ config: await send({ method: "PUT", body: JSON.stringify({ key }) }) }),
    remove: async () => set({ config: await send({ method: "DELETE" }) }),
  }));
}

/** OpenCode Go, for summaries */
export const useLlm = keyStore("/api/llm/config");
/** TypeSafe, for Jev categories */
export const useJev = keyStore("/api/jev/config");
/** The Gemini key for Reading Practice's judge. */
export const useGemini = keyStore("/api/decide/config");
