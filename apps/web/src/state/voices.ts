import { create } from "zustand";
import { DEFAULT_VOICE_ID, LOCAL_VOICE, LOCAL_VOICE_ID, OPENAI_VOICES, OPENAI_ACCENT_VOICES, FISH_DEFAULT_VOICE, FISH_PRESET_VOICES, PRESET_VOICES, hueFor, type Voice } from "../data/voices";
import { fetchServerVoices, fetchFishVoices, hasFish, hasApi, hasOpenAI, API_KIND, DEFAULT_ENGINE, OPENAI_ENGINE, FISH_ENGINE, type ServerEngine } from "../engine/providers";
import { studioJson, type Profile } from "../lib/studio";
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
  fishError: string | null;
  /** Fetch voices/engines from the speech server; keeps the defaults when it is unreachable. */
  load: () => Promise<void>;
  loadFish: () => Promise<void>;
  loadServer: () => Promise<void>;
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
  [OPENAI_ENGINE]: "OpenAI",
  [FISH_ENGINE]: "Fish Audio",
};

const cloud = () => [...(hasOpenAI() ? [...OPENAI_ACCENT_VOICES, ...OPENAI_VOICES] : []), ...(hasFish() ? FISH_PRESET_VOICES : [])];

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
  voices: [...cloud(), ...(hasApi() ? PRESET_VOICES : []), LOCAL_VOICE],
  engines: defaultEngines(),
  loaded: false,
  fishError: null,
  async load() {
    await Promise.all([get().loadFish(), get().loadServer()]);
    set({ loaded: true });
  },
  async loadFish() {
    if (!hasFish()) return;
    try {
      const voices = await fetchFishVoices();
      const fish: Voice[] = voices.map((v) => ({
        id: `fish:${v._id}`, name: v.title, lang: `${langLabel(v.languages?.[0])} · Fish Audio`,
        tags: [...(v.tags ?? []).filter((t) => typeof t === "string").slice(0, 2)],
        hue: hueFor(`fish:${v._id}`), engine: FISH_ENGINE, kind: "preset",
      }));
      const presetIds = new Set(FISH_PRESET_VOICES.map((v) => v.id));
      set({ voices: [...get().voices.filter((v) => v.engine !== FISH_ENGINE), ...FISH_PRESET_VOICES, ...fish.filter((v) => !presetIds.has(v.id))], fishError: null });
    } catch (error) {
      set({ fishError: error instanceof Error ? error.message : "Could not load Fish Audio voices" });
    }
  },
  async loadServer() {
    if (!hasApi() || API_KIND !== "openai") {
      return;
    }
    try {
      const { voices, engines } = await fetchServerVoices();
      const [metadata, capabilities] = await Promise.allSettled([
        studioJson<Profile[]>("/profiles"),
        studioJson<{ tts: { active: string } }>("/engines"),
      ]);
      const profileMap = new Map(metadata.status === "fulfilled" ? metadata.value.map((p) => [p.id, p]) : []);
      const profileEngine = capabilities.status === "fulfilled" ? capabilities.value.tts.active : "omnivoice";
      const available = new Set((engines as ServerEngine[]).filter((e) => e.available !== false).map((e) => e.id));
      const presets = available.size ? PRESET_VOICES.filter((v) => available.has(v.engine)) : PRESET_VOICES;
      const profiles: Voice[] = voices
        .filter((v) => v.type === "profile")
        .map((v) => ({ id: v.id, name: v.name, lang: langLabel(v.language), tags: [profileMap.get(v.id)?.kind === "design" ? "designed" : "cloned"], hue: hueFor(v.id), engine: profileEngine, kind: "profile" as const }));
      const engineOpts: EngineOption[] = (engines as ServerEngine[])
        .map((e) => ({ id: e.id, label: e.name || engineLabel(e.id), available: e.available !== false }))
        .concat([{ id: LOCAL_ENGINE, label: engineLabel(LOCAL_ENGINE), available: true }]);
      const clouds = get().voices.filter((v) => v.engine === OPENAI_ENGINE || v.engine === FISH_ENGINE);
      set({ voices: [...clouds, ...profiles, ...presets, LOCAL_VOICE], engines: engineOpts.length > 1 ? engineOpts : get().engines });
    } catch {
      // Keep available voices if the local speech server is offline.
    }
  },
}));

export function getVoice(id: string | null | undefined): Voice {
  const list = useVoices.getState().voices;
  const found = list.find((v) => v.id === id);
  if (found) return found;
  // A saved document can reference a voice outside the current catalogue page.
  if (hasFish() && id?.startsWith("fish:") && id.length > 5) {
    return { ...FISH_DEFAULT_VOICE, id, name: "Fish Audio voice", hue: hueFor(id) };
  }
  return list.find((v) => v.id === DEFAULT_VOICE_ID) ?? list[0];
}

export const isLocalVoice = (id: string | null | undefined) => id === LOCAL_VOICE_ID;

export { LOCAL_VOICE_ID, voiceLang } from "../data/voices";
