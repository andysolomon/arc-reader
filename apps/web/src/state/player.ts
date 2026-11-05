import { create } from "zustand";
import { PlaybackEngine, type EngineDoc, type EngineSnapshot } from "../engine/engine";
import { hasSpeechApi } from "../engine/providers";
import { positions, docs as docStore, type DocRecord } from "../lib/db";
import { segment } from "../lib/segment";
import { getVoice, voiceLang, isLocalVoice } from "./voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "./settings";
import { toast } from "./toast";

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
}

interface Actions {
  open: (rec: DocRecord, opts?: { autoplay?: boolean; resume?: boolean }) => Promise<void>;
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
  setDocVoice: (voiceId: string | null) => Promise<void>;
  setFocus: (v: boolean) => void;
  setMenuOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  clearOffline: () => void;
}

export const engine = new PlaybackEngine({
  engine: (voiceId) => {
    const v = getVoice(voiceId);
    return v.kind === "preset" ? v.engine : v.kind === "local" ? LOCAL_ENGINE : useSettings.getState().engine;
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
    void positions.put({ docId: snap.docId, index: snap.index, offset: snap.offset, fraction: snap.fraction, total: snap.total, updatedAt: Date.now() });
  },
  onError: (m) => toast(m),
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

    async open(rec, opts = {}) {
      const voiceId = rec.voice ?? useSettings.getState().voice;
      const voice = getVoice(voiceId);
      const seg = segment(rec.text);
      const doc: EngineDoc = { id: rec.id, title: rec.title, voice: voice.id, lang: voiceLang(voice), ...seg };
      let index = 0, offset = 0;
      if (opts.resume !== false) {
        const pos = await positions.get(rec.id).catch(() => undefined);
        if (pos && pos.fraction < 0.995) {
          index = pos.index;
          offset = pos.offset;
        }
      }
      engine.load(doc, index, offset);
      engine.setSpeed(get().speed || useSettings.getState().defaultSpeed);
      set({ doc, record: rec, voiceId: voice.id, menuOpen: false, focus: false, offline: get().offline && !isLocalVoice(voice.id) });
      if (opts.autoplay) void engine.play();
    },
    close() {
      engine.unload();
      set({ doc: null, record: null, focus: false, menuOpen: false });
    },
    toggle: () => engine.toggle(),
    play: () => void engine.play(),
    pause: () => engine.pause(),
    stop: () => engine.stop(),
    prev: () => engine.prev(),
    next: () => engine.next(),
    seek: (i) => engine.seek(i),
    seekFraction: (f) => engine.seekFraction(f),
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
      if (record) {
        const next = { ...record, voice: voiceId, updatedAt: Date.now() };
        await docStore.put(next);
        set({ record: next });
      }
      set({ offline: false });
      engine.setVoice(v.id, voiceLang(v));
      set({ voiceId: v.id });
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
    if (p.doc && !p.record?.voice) {
      const v = getVoice(s.voice);
      usePlayer.setState({ offline: false });
      engine.setVoice(v.id, voiceLang(v));
      usePlayer.setState({ voiceId: v.id });
    }
  }
});
