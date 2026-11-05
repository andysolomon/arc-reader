import { create } from "zustand";
import { PlaybackEngine, type EngineDoc, type EngineSnapshot } from "../engine/engine";
import { hasSpeechApi } from "../engine/providers";
import { positions, docs as docStore, type DocRecord } from "../lib/db";
import { segment } from "../lib/segment";
import { getVoice, voiceLang, isLocalVoice } from "./voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "./settings";
import { toast } from "./toast";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { hasPatois, preparePatois } from "../lib/patois";

let opening: AbortController | null = null;
let prerendering: AbortController | null = null;
let retryPreparation: (() => Promise<boolean>) | null = null;
const variant = (id: string) => id === JAMAICAN_PATOIS_VOICE_ID ? "patois" : "original";

export interface PlayerState extends EngineSnapshot {
  doc: EngineDoc | null;
  record: DocRecord | null;
  /** API unreachable: we fell back to the local voice */
  offline: boolean;
  focus: boolean;
  menuOpen: boolean;
  shortcutsOpen: boolean;
  /** Effective voice id for the loaded doc (override or default) */
  voiceId: string;
  preparing: string | null;
  preparationError: string | null;
  /** The chosen voice could not be generated; playback is stopped until the user retries or switches voice. */
  speechError: string | null;
  /** "Prepare audio" in progress: sentences rendered into the cache so far */
  prerendering: { done: number; total: number } | null;
}

interface Actions {
  /** `persist` saves the record (e.g. a voice change) once preparation succeeds. */
  open: (rec: DocRecord, opts?: { autoplay?: boolean; resume?: boolean; persist?: boolean }) => Promise<boolean>;
  cancelPreparation: () => void;
  retryPreparation: () => Promise<boolean>;
  /** Try the speech server again for the current sentence. */
  retrySpeech: () => void;
  /** Read with the browser voice until the server is back (same as going offline). */
  useBrowserVoice: () => void;
  dismissSpeechError: () => void;
  /** Render the whole document ahead of playback (for engines slower than real time). */
  prerender: () => Promise<void>;
  cancelPrerender: () => void;
  close: () => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  seek: (i: number) => void;
  seekFraction: (f: number) => void;
  setSpeed: (v: number) => void;
  nudgeSpeed: (delta: number) => void;
  setDocVoice: (voiceId: string | null) => Promise<boolean>;
  setFocus: (v: boolean) => void;
  setMenuOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  clearOffline: () => void;
}

export const engine = new PlaybackEngine({
  engine: (voiceId) => {
    const v = getVoice(voiceId);
    return v.engine;
  },
  wordTimings: () => useSettings.getState().wordTimings,
  isProfileVoice: (id) => getVoice(id).kind === "profile",
  offline: () => usePlayer.getState().offline || useSettings.getState().engine === LOCAL_ENGINE,
  onRejected: (m) => toast(m),
  onOffline: () => {
    if (!usePlayer.getState().offline) {
      usePlayer.setState({ offline: true });
      if (hasSpeechApi() && useSettings.getState().engine !== LOCAL_ENGINE) toast("Speech server unreachable — using the browser voice");
    }
  },
  onOnline: () => {
    if (usePlayer.getState().offline) usePlayer.setState({ offline: false });
  },
  onPersist: (snap) => {
    const { doc } = usePlayer.getState();
    if (!doc || !snap.docId) return;
    void positions.put({ docId: snap.docId, variant: variant(doc.voice), index: snap.index, offset: snap.offset, fraction: snap.fraction, total: snap.total, updatedAt: Date.now() });
  },
  onError: (m) => toast(m),
  onUnavailable: (m) => usePlayer.setState({ speechError: m }),
  onSlow: (factor) => {
    const name = getVoice(usePlayer.getState().voiceId).name;
    toast(`${name} takes ~${factor}× longer to generate than to play on this server, so reading pauses between sentences. Choose “Prepare audio” in the player menu, or a faster voice.`, 8000);
  },
});

export function clampSpeed(v: number) {
  return Math.round(Math.max(0.5, Math.min(3, v)) * 20) / 20;
}

export const usePlayer = create<PlayerState & Actions>()((set, get) => {
  engine.subscribe((snap) => set(snap));
  return {
    ...PlaybackEngine.empty(),
    doc: null,
    record: null,
    offline: false,
    focus: false,
    menuOpen: false,
    shortcutsOpen: false,
    voiceId: useSettings.getState().voice,
    preparing: null,
    preparationError: null,
    speechError: null,
    prerendering: null,

    async open(rec, opts = {}) {
      opening?.abort();
      get().cancelPrerender();
      const controller = new AbortController();
      opening = controller;
      const { signal } = controller;
      retryPreparation = () => get().open(rec, opts);
      set({ preparationError: null, speechError: null });
      try {
      const voiceId = rec.voice ?? useSettings.getState().voice;
      const voice = getVoice(voiceId);
      const rewrite = voiceId === JAMAICAN_PATOIS_VOICE_ID && !hasPatois(rec);
      if (rewrite) {
        engine.pause();
        set({ preparing: "Rewriting into Jamaican Patois…" });
      }
      const prepared = voiceId === JAMAICAN_PATOIS_VOICE_ID
        ? await preparePatois(rec, signal, (preparing) => { if (!signal.aborted) set({ preparing }); })
        : rec;
      signal.throwIfAborted();
      const seg = segment(voiceId === JAMAICAN_PATOIS_VOICE_ID ? prepared.patois!.text : prepared.text);
      const doc: EngineDoc = { id: rec.id, title: rec.title, voice: voice.id, lang: voiceLang(voice), ...seg };
      let index = 0, offset = 0;
      if (opts.resume !== false) {
        const pos = await positions.get(rec.id).catch(() => undefined);
        if (pos && (pos.variant ?? "original") === variant(voiceId) && pos.fraction < 0.995) {
          index = pos.index;
          offset = pos.offset;
        }
      }
      signal.throwIfAborted();
      if (rewrite || opts.persist) await docStore.put(prepared);
      signal.throwIfAborted();
      engine.load(doc, index, offset);
      engine.setSpeed(get().speed || useSettings.getState().defaultSpeed);
      set({ doc, record: prepared, voiceId: voice.id, menuOpen: false, focus: false, offline: get().offline && !isLocalVoice(voice.id) });
      if (opts.autoplay) void engine.play();
      retryPreparation = null;
      return true;
      } catch (error) {
        if (!signal.aborted) {
          const message = error instanceof Error ? error.message : "Could not prepare this reading.";
          set({ preparationError: message });
        }
        return false;
      } finally {
        if (opening === controller) {
          opening = null;
          set({ preparing: null });
        }
      }
    },
    cancelPreparation() {
      opening?.abort();
      opening = null;
      retryPreparation = null;
      set({ preparing: null, preparationError: null });
    },
    retryPreparation: async () => retryPreparation ? retryPreparation() : false,
    retrySpeech() {
      set({ speechError: null });
      void engine.play();
    },
    useBrowserVoice() {
      set({ speechError: null, offline: true });
      void engine.play();
    },
    dismissSpeechError: () => set({ speechError: null }),
    async prerender() {
      const { doc } = get();
      if (prerendering || !doc) return;
      const controller = new AbortController();
      prerendering = controller;
      const total = doc.sentences.length;
      set({ prerendering: { done: 0, total } });
      try {
        await engine.prepare((done) => { if (prerendering === controller) set({ prerendering: { done, total } }); }, controller.signal);
        if (!controller.signal.aborted && get().doc === doc) toast("Audio prepared — playback no longer waits on the server");
      } finally {
        if (prerendering === controller) {
          prerendering = null;
          set({ prerendering: null });
        }
      }
    },
    cancelPrerender() {
      prerendering?.abort();
      prerendering = null;
      set({ prerendering: null });
    },
    close() {
      get().cancelPreparation();
      get().cancelPrerender();
      engine.unload();
      set({ doc: null, record: null, focus: false, menuOpen: false, speechError: null });
    },
    toggle: () => { if (!get().preparing) engine.toggle(); },
    play: () => { if (!get().preparing) void engine.play(); },
    pause: () => engine.pause(),
    stop: () => engine.stop(),
    prev: () => { if (!get().preparing) engine.prev(); },
    next: () => { if (!get().preparing) engine.next(); },
    seek: (i) => { if (!get().preparing) engine.seek(i); },
    seekFraction: (f) => { if (!get().preparing) engine.seekFraction(f); },
    setSpeed(v) {
      const s = clampSpeed(v);
      engine.setSpeed(s);
      toast(`${Number(s.toFixed(2))}× speed`);
    },
    nudgeSpeed(delta) {
      get().setSpeed(get().speed + delta);
    },
    async setDocVoice(voiceId) {
      const { record } = get();
      const v = getVoice(voiceId ?? useSettings.getState().voice);
      const wasPlaying = get().playing;
      get().cancelPreparation();
      set({ speechError: null });
      get().cancelPrerender();
      if (record) {
        const next = { ...record, voice: voiceId, updatedAt: Date.now() };
        if (variant(v.id) !== variant(get().voiceId) || v.id === JAMAICAN_PATOIS_VOICE_ID) {
          set({ offline: false });
          return get().open(next, { autoplay: wasPlaying, resume: variant(v.id) === variant(get().voiceId), persist: true });
        }
        await docStore.put(next);
        set({ record: next });
      }
      set({ offline: false });
      engine.setVoice(v.id, voiceLang(v));
      set({ voiceId: v.id, doc: get().doc ? { ...get().doc!, voice: v.id, lang: voiceLang(v) } : null });
      return true;
    },
    setFocus: (v) => set({ focus: v }),
    setMenuOpen: (v) => set({ menuOpen: v }),
    setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
    clearOffline: () => set({ offline: false }),
  };
});

// Default speed from settings on first load
engine.setSpeed(useSettings.getState().defaultSpeed);

// If the default voice changes while a doc without an override is loaded, follow it.
useSettings.subscribe((s, prev) => {
  if (s.voice !== prev.voice) {
    const p = usePlayer.getState();
    p.cancelPreparation();
    if (p.doc && !p.record?.voice) {
      void p.setDocVoice(null).catch((error: Error) => toast(error.message));
    }
  }
});
