import { create } from "zustand";
import { DEFAULT_VOICES, DEFAULT_VOICE_ID, LOCAL_VOICE, LOCAL_VOICE_ID, PRESET_VOICES, hueFor, type Voice } from "../data/voices";
import { fetchServerVoices, hasApi, API_KIND, DEFAULT_ENGINE, type ServerEngine } from "../engine/providers";
import { LOCAL_ENGINE } from "../engine/types";

export interface EngineOption {
  id: string;
  label: string;
  available: boolean;
}

interface VoicesState {
  voices: Voice[];
  engines: EngineOption[];
  loaded: boolean;
  /** Fetch voices/engines from the speech server; keeps the defaults when it is unreachable. */
  load: () => Promise<void>;
}

const ENGINE_LABELS: Record<string, string> = {
  kittentts: "KittenTTS",
  supertonic3: "Supertonic-3",
  pockettts: "PocketTTS",
  "moss-tts-nano": "MOSS-TTS-Nano",
  omnivoice: "OmniVoice",
  voxcpm2: "VoxCPM2",
  cosyvoice: "CosyVoice 3",
  [LOCAL_ENGINE]: "Browser voice",
};

export const engineLabel = (id: string) => ENGINE_LABELS[id] ?? id;

function defaultEngines(): EngineOption[] {
  const ids = hasApi() ? [DEFAULT_ENGINE, "kittentts", "supertonic3"] : [];
  const uniq = Array.from(new Set(ids));
  return [...uniq.map((id) => ({ id, label: engineLabel(id), available: true })), { id: LOCAL_ENGINE, label: engineLabel(LOCAL_ENGINE), available: true }];
}

function langLabel(l: string | null | undefined): string {
  if (!l) return "EN-US";
  const m = l.match(/^([a-z]{2})(?:[-_]([a-zA-Z]{2}))?/i);
  if (!m) return l.toUpperCase();
  return m[2] ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : m[1].toUpperCase();
}

export const useVoices = create<VoicesState>()((set, get) => ({
  voices: DEFAULT_VOICES,
  engines: defaultEngines(),
  loaded: false,
  async load() {
    if (!hasApi() || API_KIND !== "openai") {
      set({ loaded: true });
      return;
    }
    try {
      const { voices, engines } = await fetchServerVoices();
      const available = new Set((engines as ServerEngine[]).filter((e) => e.available !== false).map((e) => e.id));
      const presets = available.size ? PRESET_VOICES.filter((v) => available.has(v.engine)) : PRESET_VOICES;
      const profiles: Voice[] = voices
        .filter((v) => v.type === "profile")
        .map((v) => ({ id: v.id, name: v.name, lang: langLabel(v.language), tags: ["cloned"], hue: hueFor(v.id), engine: DEFAULT_ENGINE, kind: "profile" as const }));
      const engineOpts: EngineOption[] = (engines as ServerEngine[])
        .map((e) => ({ id: e.id, label: e.name || engineLabel(e.id), available: e.available !== false }))
        .concat([{ id: LOCAL_ENGINE, label: engineLabel(LOCAL_ENGINE), available: true }]);
      set({ voices: [...profiles, ...presets, LOCAL_VOICE], engines: engineOpts.length > 1 ? engineOpts : get().engines, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

export function getVoice(id: string | null | undefined): Voice {
  const list = useVoices.getState().voices;
  return list.find((v) => v.id === id) ?? list.find((v) => v.id === DEFAULT_VOICE_ID) ?? list[0];
}

export const isLocalVoice = (id: string | null | undefined) => id === LOCAL_VOICE_ID;

export { LOCAL_VOICE_ID, voiceLang } from "../data/voices";
