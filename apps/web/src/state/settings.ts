import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type ThemeId, isThemeId, systemTheme } from "@readaloud/tokens";
import type { HighlightMode } from "@readaloud/ui";
import type { ProviderId } from "../engine/types";

export type PlayerStyle = "capsule" | "bar";
export type ComposeLayout = "centered" | "editorial";

export interface Settings {
  /** null = follow the OS until the user picks one */
  theme: ThemeId | null;
  playerStyle: PlayerStyle;
  highlightStyle: HighlightMode;
  composeLayout: ComposeLayout;
  voice: string;
  defaultSpeed: number;
  autoplayShare: boolean;
  provider: ProviderId;
  fontSize: number;
  wide: boolean;
  railOpen: boolean;
  libView: "list" | "grid";
  apiKey: string;
  email: string | null;
}

interface Actions {
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  patch: (p: Partial<Settings>) => void;
}

function genKey() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "ra_live_";
  const bytes = new Uint8Array(28);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export const useSettings = create<Settings & Actions>()(
  persist(
    (set) => ({
      theme: null,
      playerStyle: "capsule",
      highlightStyle: "block",
      composeLayout: "centered",
      voice: "ava",
      defaultSpeed: 1,
      autoplayShare: true,
      provider: "auto",
      fontSize: 19,
      wide: false,
      railOpen: typeof window === "undefined" ? true : window.innerWidth > 1024,
      libView: "list",
      apiKey: typeof crypto !== "undefined" ? genKey() : "ra_live_unavailable",
      email: null,
      set: (k, v) => set({ [k]: v } as Partial<Settings>),
      patch: (p) => set(p),
    }),
    {
      name: "readaloud:settings",
      version: 1,
      partialize: (s) => {
        const { set: _s, patch: _p, ...rest } = s;
        return rest;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        return { ...current, ...p, theme: isThemeId(p.theme) ? p.theme : null };
      },
    },
  ),
);

/** Effective theme id (settings or OS preference). */
export function useThemeId(): ThemeId {
  return useSettings((s) => s.theme) ?? systemTheme();
}
