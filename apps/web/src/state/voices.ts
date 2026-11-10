import { create } from "zustand";
import { DEFAULT_VOICE_ID, isDefaultArchetype, LOCAL_VOICE, LOCAL_VOICE_ID, OPENAI_VOICES, OPENAI_ACCENT_VOICES, FISH_DEFAULT_VOICE, FISH_PRESET_VOICES, PRESET_VOICES, hueFor, type Voice } from "../data/voices";
import { fetchServerVoices, fetchFishVoices, hasFish, hasApi, hasOpenAI, API_KIND, OPENAI_ENGINE, FISH_ENGINE, type ServerEngine } from "../engine/providers";
import { archetypeOf, idPath, studioFetch, studioJson, type Profile } from "../lib/studio";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "./settings";

export interface EngineOption {
  id: string;
  label: string;
  available: boolean;
  /** Can speak cloned and designed (profile) voices. */
  cloning: boolean;
}

interface VoicesState {
  voices: Voice[];
  /** TTS backends reported by the speech server (installed or not). */
  engines: EngineOption[];
  /** The server's active engine, which speaks profile voices; null until known. */
  activeEngine: string | null;
  loaded: boolean;
  fishError: string | null;
  /** Fetch voices/engines from the speech server; keeps the defaults when it is unreachable. */
  load: () => Promise<void>;
  loadFish: () => Promise<void>;
  loadServer: () => Promise<void>;
  /** Delete a saved VoiceStudio profile. A gallery voice reappears in Studio; a clone's reference is gone for good. */
  remove: (id: string) => Promise<void>;
}

const ENGINE_LABELS: Record<string, string> = {
  kittentts: "KittenTTS",
  supertonic3: "Supertonic-3",
  pockettts: "PocketTTS",
  "moss-tts-nano": "MOSS-TTS-Nano",
  omnivoice: "OmniVoice",
  "omnivoice-subprocess": "OmniVoice (isolated)",
  voxcpm2: "VoxCPM2",
  cosyvoice: "CosyVoice 3",
  [LOCAL_ENGINE]: "Browser voice",
  [OPENAI_ENGINE]: "OpenAI",
  [FISH_ENGINE]: "Fish Audio",
};

const cloud = () => [...(hasOpenAI() ? [...OPENAI_ACCENT_VOICES, ...OPENAI_VOICES] : []), ...(hasFish() ? FISH_PRESET_VOICES : [])];

export const engineLabel = (id: string) => ENGINE_LABELS[id] ?? id;

function langLabel(l: string | null | undefined): string {
  if (!l) return "EN-US";
  // VoiceStudio stores "Auto" for cloned voices that detect the language of each text.
  if (/^auto/i.test(l)) return "Auto";
  const m = l.match(/^([a-z]{2})(?:[-_]([a-zA-Z]{2}))?/i);
  if (!m) return l.toUpperCase();
  return m[2] ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : m[1].toUpperCase();
}

export const useVoices = create<VoicesState>()((set, get) => ({
  voices: [...(hasApi() ? PRESET_VOICES : []), ...cloud(), LOCAL_VOICE],
  engines: [],
  activeEngine: null,
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
      const activeEngine = capabilities.status === "fulfilled" ? capabilities.value.tts.active : null;
      const profileEngine = activeEngine ?? "omnivoice";
      const available = new Set((engines as ServerEngine[]).filter((e) => e.available !== false).map((e) => e.id));
      const presets = available.size ? PRESET_VOICES.filter((v) => available.has(v.engine)) : PRESET_VOICES;
      const profiles: Voice[] = voices
        .filter((v) => v.type === "profile")
        .map((v): Voice => {
          const profile = profileMap.get(v.id);
          const archetype = archetypeOf(profile);
          return { id: v.id, name: v.name, lang: langLabel(v.language), tags: [profile?.kind === "design" ? "designed" : "cloned"], hue: hueFor(v.id), engine: profileEngine, kind: "profile", ...(archetype ? { archetype } : {}) };
        });
      const engineOpts: EngineOption[] = (engines as ServerEngine[])
        .map((e) => ({ id: e.id, label: e.name || engineLabel(e.id), available: e.available !== false, cloning: e.supports_cloning === true }));
      const clouds = get().voices.filter((v) => v.engine === OPENAI_ENGINE || v.engine === FISH_ENGINE);
      set({ voices: [...profiles, ...presets, ...clouds, LOCAL_VOICE], engines: engineOpts.length ? engineOpts : get().engines, activeEngine: activeEngine ?? get().activeEngine });
      adoptDefaultVoice(profiles);
    } catch {
      // Keep available voices if the local speech server is offline.
    }
  },
  async remove(id) {
    await studioFetch(`/profiles/${idPath(id)}`, { method: "DELETE" });
    set({ voices: get().voices.filter((v) => v.id !== id) });
    await get().loadServer();
  },
}));

/** Make the Librarian the default voice unless the user has picked one. */
function adoptDefaultVoice(profiles: Voice[]) {
  const settings = useSettings.getState();
  if (settings.voiceChosen || settings.voice !== DEFAULT_VOICE_ID) return;
  const librarian = profiles.find((v) => isDefaultArchetype(v.archetype));
  if (librarian) settings.set("voice", librarian.id);
}

export function getVoice(id: string | null | undefined): Voice {
  const list = useVoices.getState().voices;
  const found = list.find((v) => v.id === id);
  if (found) return found;
  const preset = [...PRESET_VOICES, ...OPENAI_VOICES, ...OPENAI_ACCENT_VOICES, ...FISH_PRESET_VOICES, LOCAL_VOICE].find((v) => v.id === id);
  if (preset) return preset;
  // A saved document can reference a voice outside the current catalogue page.
  if (id?.startsWith("fish:") && id.length > 5) {
    return { ...FISH_DEFAULT_VOICE, id, name: "Fish Audio voice", hue: hueFor(id) };
  }
  if (id) return { id, name: "Saved VoiceStudio voice", engine: useVoices.getState().activeEngine ?? "omnivoice", kind: "profile", lang: "", tags: [], hue: hueFor(id) };
  return list.find((v) => isDefaultArchetype(v.archetype)) ?? list.find((v) => v.id === DEFAULT_VOICE_ID) ?? PRESET_VOICES[0];
}

export const isLocalVoice = (id: string | null | undefined) => id === LOCAL_VOICE_ID;

export { LOCAL_VOICE_ID, voiceLang } from "../data/voices";
