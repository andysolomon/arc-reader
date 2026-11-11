import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type ThemeId, isThemeId, systemTheme } from "@readaloud/tokens";
import type { HighlightMode } from "@readaloud/ui";
import { LOCAL_ENGINE, type EngineId } from "../engine/types";
import { DEFAULT_ENGINE, OPENAI_MODEL, OPENAI_STANDARD_MODEL, OPENAI_STEADY_MODEL } from "../engine/providers";
import { DEFAULT_VOICE_ID } from "../data/voices";
import { setSpeechEndpoint } from "../lib/speechServer";
import { DEFAULT_SUMMARY_MODEL, isSummaryModel, type SummaryModel } from "../lib/summary";

export type PlayerStyle = "capsule" | "bar";
export type ComposeLayout = "centered" | "editorial";

export interface Settings {
  /** null = follow the OS until the user picks one */
  theme: ThemeId | null;
  playerStyle: PlayerStyle;
  highlightStyle: HighlightMode;
  composeLayout: ComposeLayout;
  voice: string;
  /** The user picked the default voice; until then the Librarian replaces the fallback once it loads. */
  voiceChosen: boolean;
  defaultSpeed: number;
  autoplayShare: boolean;
  /** Show a toast for each link once the words it was attached to have been read */
  linkToasts: boolean;
  /** TTS engine id from the speech server, or "local" for the browser voice */
  engine: EngineId;
  /** Phase 4: derive word timings from the server's transcription endpoint (extra request per passage) */
  wordTimings: boolean;
  /** OpenAI reading model: the steady model, or the cheaper standard one */
  openaiModel: string;
  /** LLM that writes article summaries */
  summaryModel: SummaryModel;
  /** Show the summary panel above the text in the Reader */
  showSummary: boolean;
  fontSize: number;
  wide: boolean;
  railOpen: boolean;
  libView: "list" | "grid";
  apiKey: string;
  email: string | null;
  /**
   * Absolute speech-server URL for the iOS app. Empty uses the build-time base
   * on the web, and the on-device voice in the iOS shell.
   */
  speechServer: string;
  /** VoiceStudio key sent only with an absolute speech-server URL. */
  speechServerKey: string;
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
      voice: DEFAULT_VOICE_ID,
      voiceChosen: false,
      defaultSpeed: 1,
      autoplayShare: true,
      linkToasts: true,
      engine: DEFAULT_ENGINE,
      wordTimings: false,
      openaiModel: OPENAI_MODEL,
      summaryModel: DEFAULT_SUMMARY_MODEL,
      showSummary: false,
      fontSize: 19,
      wide: false,
      railOpen: typeof window === "undefined" ? true : window.innerWidth > 1024,
      libView: "list",
      apiKey: typeof crypto !== "undefined" ? genKey() : "ra_live_unavailable",
      email: null,
      speechServer: "",
      speechServerKey: "",
      set: (k, v) => set({ [k]: v } as Partial<Settings>),
      patch: (p) => set(p),
    }),
    {
      name: "readaloud:settings",
      version: 3,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<Settings> & { provider?: string };
        if (version < 2) {
          p.engine = p.provider === "piper" ? LOCAL_ENGINE : DEFAULT_ENGINE;
          delete p.provider;
          if (p.voice && !/^(expr-voice-|[MF][1-5]$|local$)/.test(p.voice)) p.voice = DEFAULT_VOICE_ID;
        }
        if (version < 3) {
          // The Librarian became the default voice: let it take over once, then respect the next pick.
          p.voice = DEFAULT_VOICE_ID;
          p.voiceChosen = false;
        }
        return p as Settings;
      },
      partialize: (s) => {
        const { set: _s, patch: _p, ...rest } = s;
        return rest;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        const openaiModel = p.openaiModel === OPENAI_STEADY_MODEL || p.openaiModel === OPENAI_STANDARD_MODEL ? p.openaiModel : current.openaiModel;
        const summaryModel = isSummaryModel(p.summaryModel) ? p.summaryModel : current.summaryModel;
        return { ...current, ...p, theme: isThemeId(p.theme) ? p.theme : null, openaiModel, summaryModel };
      },
    },
  ),
);

/** Effective theme id (settings or OS preference). */
export function useThemeId(): ThemeId {
  return useSettings((s) => s.theme) ?? systemTheme();
}

function publishSpeechEndpoint(state: { speechServer?: string; speechServerKey?: string }) {
  setSpeechEndpoint({ override: state.speechServer ?? "", key: state.speechServerKey ?? "" });
}

publishSpeechEndpoint(useSettings.getState());
useSettings.subscribe((state) => publishSpeechEndpoint(state));
