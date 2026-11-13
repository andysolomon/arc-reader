import { create } from "zustand";
import { DEFAULT_VOICE_ID, FALLBACK_VOICE_ID, LOCAL_VOICE, LOCAL_VOICE_ID, OPENAI_VOICES, OPENAI_ACCENT_VOICES, FISH_DEFAULT_VOICE, FISH_PRESET_VOICES, PHONON_PREFIX, PHONON_VOICES, PRESET_VOICES, hueFor, phononVoice, type Voice } from "../data/voices";
import { fetchServerVoices, fetchFishVoices, fetchPhononVoices, hasFish, hasApi, hasOpenAI, hasPhonon, hasOwnServer, API_KIND, OPENAI_ENGINE, FISH_ENGINE, PHONON_ENGINE, type ServerEngine } from "../engine/providers";
import { archetypeOf, idPath, recordingRevision, studioFetch, studioJson, type Profile } from "../lib/studio";
import { setVoiceRevision, setVoiceRevisions } from "../engine/voiceRevisions";
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
  /** Match the Phonon list to what its server offers; keeps the built-in list when it is unreachable. */
  loadPhonon: () => Promise<void>;
  loadServer: () => Promise<void>;
  /** Delete a saved VoiceStudio profile. A gallery voice reappears in Studio; a clone's reference is gone for good. */
  remove: (id: string) => Promise<void>;
  /** Replace a clone's reference recording, keeping its id. A blank transcript is transcribed by VoiceStudio. */
  rerecord: (id: string, recording: File, words: string, name?: string) => Promise<Profile>;
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
  [PHONON_ENGINE]: "Phonon",
};

/** Voices from servers other than VoiceStudio: Phonon, then the cloud services. */
const elsewhere = () => [...(hasPhonon() ? PHONON_VOICES : []), ...(hasOpenAI() ? [...OPENAI_ACCENT_VOICES, ...OPENAI_VOICES] : []), ...(hasFish() ? FISH_PRESET_VOICES : [])];

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
  voices: [...(hasApi() ? PRESET_VOICES : []), ...elsewhere(), LOCAL_VOICE],
  engines: [],
  activeEngine: null,
  loaded: false,
  fishError: null,
  async load() {
    await Promise.all([get().loadFish(), get().loadPhonon(), get().loadServer()]);
    set({ loaded: true });
    adoptDefaultVoice();
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
  async loadPhonon() {
    if (!hasPhonon()) return;
    try {
      const names = new Set((await fetchPhononVoices()).filter((name) => name !== "default"));
      if (!names.size) return;
      // The catalogue's order (narrators, then characters), then voices it does not know yet.
      const known = PHONON_VOICES.filter((v) => names.delete(v.name));
      const listed = [...known, ...[...names].map((name) => phononVoice(name))];
      // Phonon stays after VoiceStudio's voices and before the cloud services.
      const voices = get().voices.filter((v) => v.engine !== PHONON_ENGINE);
      const at = Math.max(0, voices.findIndex((v) => hasOwnServer(v.engine) || v.kind === "local"));
      set({ voices: [...voices.slice(0, at), ...listed, ...voices.slice(at)] });
    } catch {
      // Keep the built-in list if the Phonon server is offline.
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
      if (metadata.status === "fulfilled") {
        setVoiceRevisions(Object.fromEntries(metadata.value.flatMap((p) => { const revision = recordingRevision(p); return revision ? [[p.id, revision]] : []; })));
      }
      const activeEngine = capabilities.status === "fulfilled" ? capabilities.value.tts.active : null;
      const profileEngine = activeEngine ?? "omnivoice";
      const available = new Set((engines as ServerEngine[]).filter((e) => e.available !== false).map((e) => e.id));
      const presets = available.size ? PRESET_VOICES.filter((v) => available.has(v.engine)) : PRESET_VOICES;
      const profiles: Voice[] = voices
        .filter((v) => v.type === "profile")
        .map((v): Voice => {
          const profile = profileMap.get(v.id);
          const archetype = archetypeOf(profile);
          return { id: v.id, name: v.name, lang: langLabel(v.language), tags: [profile?.kind === "design" ? "designed" : "cloned"], description: profile?.instruct || (!archetype ? profile?.personality ?? undefined : undefined), hue: hueFor(v.id), engine: profileEngine, kind: "profile", ...(archetype ? { archetype } : {}) };
        });
      const engineOpts: EngineOption[] = (engines as ServerEngine[])
        .map((e) => ({ id: e.id, label: e.name || engineLabel(e.id), available: e.available !== false, cloning: e.supports_cloning === true }));
      const others = get().voices.filter((v) => hasOwnServer(v.engine));
      set({ voices: [...profiles, ...presets, ...others, LOCAL_VOICE], engines: engineOpts.length ? engineOpts : get().engines, activeEngine: activeEngine ?? get().activeEngine });
    } catch {
      // Keep available voices if the local speech server is offline.
    }
  },
  async remove(id) {
    await studioFetch(`/profiles/${idPath(id)}`, { method: "DELETE" });
    set({ voices: get().voices.filter((v) => v.id !== id) });
    await get().loadServer();
  },
  async rerecord(id, recording, words, name) {
    const body = new FormData();
    body.set("ref_audio", recording);
    body.set("ref_text", words.trim());
    if (name?.trim()) body.set("name", name.trim());
    const profile = await studioJson<Profile>(`/profiles/${idPath(id)}/audio`, { method: "PUT", body });
    // Adopt the new revision at once so nothing replays the old recording while the list reloads.
    const revision = recordingRevision(profile);
    if (revision) setVoiceRevision(id, revision);
    await get().loadServer();
    return profile;
  },
}));

/** Zoey when this deployment has Phonon, Bella when it does not. */
export const defaultVoiceId = () => (useVoices.getState().voices.some((v) => v.id === DEFAULT_VOICE_ID) ? DEFAULT_VOICE_ID : FALLBACK_VOICE_ID);

/** Keep the default voice speakable here unless the user has picked one. */
function adoptDefaultVoice() {
  const settings = useSettings.getState();
  if (settings.voiceChosen || (settings.voice !== DEFAULT_VOICE_ID && settings.voice !== FALLBACK_VOICE_ID)) return;
  const id = defaultVoiceId();
  if (settings.voice !== id) settings.set("voice", id);
}

export function getVoice(id: string | null | undefined): Voice {
  const list = useVoices.getState().voices;
  const found = list.find((v) => v.id === id);
  if (found) return found;
  const preset = [...PRESET_VOICES, ...PHONON_VOICES, ...OPENAI_VOICES, ...OPENAI_ACCENT_VOICES, ...FISH_PRESET_VOICES, LOCAL_VOICE].find((v) => v.id === id);
  if (preset) return preset;
  // A saved document can use a Phonon voice the server no longer lists.
  if (id?.startsWith(PHONON_PREFIX) && id.length > PHONON_PREFIX.length) return phononVoice(id.slice(PHONON_PREFIX.length));
  // A saved document can reference a voice outside the current catalogue page.
  if (id?.startsWith("fish:") && id.length > 5) {
    return { ...FISH_DEFAULT_VOICE, id, name: "Fish Audio voice", hue: hueFor(id) };
  }
  if (id) return { id, name: "Saved VoiceStudio voice", engine: useVoices.getState().activeEngine ?? "omnivoice", kind: "profile", lang: "", tags: [], hue: hueFor(id) };
  return list.find((v) => v.id === DEFAULT_VOICE_ID) ?? list.find((v) => v.id === FALLBACK_VOICE_ID) ?? PRESET_VOICES[0];
}

export const isLocalVoice = (id: string | null | undefined) => id === LOCAL_VOICE_ID;

export { LOCAL_VOICE_ID, voiceLang } from "../data/voices";
