import { prepareVisualDescriptions } from "../lib/visualDescriptions";
import type { VisualDescriptions } from "../lib/visuals";
import { create } from "zustand";
import { PlaybackEngine, type EngineDoc, type EngineSnapshot } from "../engine/engine";
import { hasSpeechApi, isPaidEngine, preparationRequests, prepareInBackground, usesBuiltInProxy } from "../engine/providers";
import { hasActivePreparation } from "../engine/preparation";
import { positions, docs as docStore, type DocRecord } from "../lib/db";
import { FINISHED_FRACTION } from "../lib/libraryProtocol";
import { segment } from "../lib/segment";
import { getVoice, voiceLang, isLocalVoice } from "./voices";
import { LOCAL_ENGINE } from "../engine/types";
import { useSettings } from "./settings";
import { toast } from "./toast";
import { JAMAICAN_PATOIS_VOICE_ID } from "../data/voices";
import { hasPatois, preparePatois } from "../lib/patois";
import { hasSummary } from "../lib/summary";
import { prepareCodeSummaries } from "../lib/codeSummaries";
import { readingBlocks } from "../lib/codeBlocks";
import { catalogue } from "../lib/postTitle";

let opening: AbortController | null = null;
let prerendering: AbortController | null = null;
/** The deck whose slides are being described: its audio is not final until they are. */
let describingDeck: string | null = null;
/** The document whose audio finished preparing while its slides were still being described. */
let heldBack: string | null = null;
const PREPARED = "Audio prepared — playback no longer waits on the server";
/** Image descriptions being written for the open reading after it started. */
let describing: AbortController | null = null;
let retryPreparation: (() => Promise<boolean>) | null = null;
/** The end of the current reading has already been counted; cleared once playback leaves the end. */
let endCounted = false;
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
  /** Reading the document's summary instead of its text; positions and read counts are left alone. */
  summary: boolean;
  preparing: string | null;
  preparationError: string | null;
  /** The chosen voice could not be generated; playback is stopped until the user retries or switches voice. */
  speechError: string | null;
  /** "Prepare audio" in progress: passages rendered so far */
  prerendering: { done: number; total: number } | null;
}

interface Actions {
  /** `persist` saves the record (e.g. a voice change) once preparation succeeds. */
  open: (rec: DocRecord, opts?: { autoplay?: boolean; resume?: boolean; persist?: boolean; prepare?: boolean; summary?: boolean }) => Promise<boolean>;
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
  openaiModel: () => useSettings.getState().openaiModel,
  isProfileVoice: (id) => getVoice(id).kind === "profile",
  offline: () => usePlayer.getState().offline || useSettings.getState().engine === LOCAL_ENGINE,
  prepareAudio: prepareInBackground,
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
    const { doc, summary } = usePlayer.getState();
    // The summary is short and separate: keep the place in the full text.
    if (!doc || !snap.docId || summary) return;
    const completed = snap.ended && !endCounted;
    endCounted = snap.ended;
    void positions.put({ docId: snap.docId, variant: variant(doc.voice), narrationVersion: 2, index: snap.index, offset: snap.offset, fraction: snap.fraction, total: snap.total, updatedAt: Date.now() }, { completed });
  },
  onError: (m) => toast(m),
  onUnavailable: (m) => usePlayer.setState({ speechError: m }),
  onSlow: (factor) => {
    const voice = getVoice(usePlayer.getState().voiceId);
    // Prepare audio is not offered for paid engines (it would bill the whole document up front).
    const fix = isPaidEngine(voice.engine) ? "Choose a faster voice." : "Choose “Prepare audio” in the player menu, or a faster voice.";
    toast(`${voice.name} takes ~${factor}× longer to generate than to play on this server, so reading pauses between passages. ${fix}`, 8000);
  },
});

/** Resolves once `ready` holds, looking again each second; rejects when cancelled. */
function until(ready: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal.aborted) { clearInterval(timer); reject(signal.reason); }
      else if (ready()) { clearInterval(timer); resolve(); }
    };
    const timer = setInterval(check, 1000);
    check();
  });
}

export function clampSpeed(v: number) {
  return Math.round(Math.max(0.5, Math.min(3, v)) * 20) / 20;
}

export const usePlayer = create<PlayerState & Actions>()((set, get) => {
  engine.subscribe((snap) => set(snap));

  /**
   * Save descriptions for a reading's images and swap them into it, keeping the listener's place.
   * A deck's slides are described from that place onwards, a few at a time as they arrive.
   */
  async function describeVisuals(id: string, opened: DocRecord, readingText: string, autoPrepare: boolean, signal: AbortSignal) {
    const swapIn = async (found: VisualDescriptions) => {
      const latest = await docStore.get(id);
      if (signal.aborted || !latest || latest.text !== opened.text) return;
      const record = { ...latest, visualDescriptions: { ...latest.visualDescriptions, ...found } };
      await docStore.put(record);
      const { doc } = get();
      if (signal.aborted || doc?.id !== id) return;
      const next: EngineDoc = { ...doc, ...segment(readingText, record.codeSummaries, record.visualDescriptions) };
      if (!engine.replaceText(next)) return;
      set({ doc: next, record });
      // Prepared audio follows the new wording.
      if (autoPrepare || prerendering) { get().cancelPrerender(); void get().prerender(); }
    };
    try {
      const slides = readingBlocks(readingText).some((block) => block.kind === "visual" && block.visual.kind === "slide");
      if (slides) {
        // Describing a deck is a call to the model for most of its slides: wait until it is being listened to.
        await until(() => get().doc?.id === id && (get().playing || get().index > 0), signal);
        describingDeck = id;
      }
      await prepareVisualDescriptions(opened, readingText, signal, () => {}, {
        all: true,
        heard: () => { const { doc, index } = get(); return doc?.id === id ? doc.paragraphs.filter((p) => p.visual && p.start < index).length : 0; },
        found: swapIn,
      });
    } catch { /* Captions and alt text keep serving. */ }
    if (describingDeck !== id) return;
    describingDeck = null;
    // Audio that finished in the meantime was not announced, since its wording was still changing.
    if (heldBack === id && !prerendering && !signal.aborted && get().doc?.id === id) toast(PREPARED);
    heldBack = null;
  }

  return {
    ...PlaybackEngine.empty(),
    doc: null,
    record: null,
    offline: false,
    focus: false,
    menuOpen: false,
    shortcutsOpen: false,
    voiceId: useSettings.getState().voice,
    summary: false,
    preparing: null,
    preparationError: null,
    speechError: null,
    prerendering: null,

    async open(rec, opts = {}) {
      opening?.abort();
      describing?.abort();
      describing = null;
      get().cancelPrerender();
      const controller = new AbortController();
      opening = controller;
      const { signal } = controller;
      retryPreparation = () => get().open(rec, opts);
      set({ preparationError: null, speechError: null });
      try {
      const voiceId = rec.voice ?? useSettings.getState().voice;
      const voice = getVoice(voiceId);
      // Summaries are read as written, in any voice.
      const summary = !!opts.summary && hasSummary(rec);
      const patois = voiceId === JAMAICAN_PATOIS_VOICE_ID && !summary;
      const rewrite = patois && !hasPatois(rec);
      if (rewrite) {
        engine.pause();
        set({ preparing: "Rewriting into Jamaican Patois…" });
      }
      let prepared = patois
        ? await preparePatois(rec, signal, (preparing) => { if (!signal.aborted) set({ preparing }); })
        : rec;
      signal.throwIfAborted();
      const readingText = summary ? rec.summary!.text : patois ? prepared.patois!.text : prepared.text;
      if (readingBlocks(readingText).some((block) => block.kind === "code")) {
        engine.pause();
        prepared = await prepareCodeSummaries(prepared, readingText, useSettings.getState().summaryModel, signal,
          (preparing) => { if (!signal.aborted) set({ preparing }); });
      }
      signal.throwIfAborted();
      const seg = segment(readingText, prepared.codeSummaries, prepared.visualDescriptions);
      const doc: EngineDoc = { id: rec.id, title: catalogue(rec).title, voice: voice.id, lang: voiceLang(voice), ...seg };
      let index = 0, offset = 0;
      if (opts.resume !== false && !summary) {
        const pos = await positions.get(rec.id).catch(() => undefined);
        if (pos && (pos.variant ?? "original") === variant(voiceId) && pos.fraction < FINISHED_FRACTION
          && ((pos.narrationVersion ?? 0) >= 1 || !seg.paragraphs.some((p) => p.code))
          && (pos.narrationVersion === 2 || !seg.paragraphs.some((p) => p.visual))) {
          index = pos.index;
          offset = pos.offset;
        }
      }
      signal.throwIfAborted();
      if (rewrite || opts.persist || prepared.codeSummaries !== rec.codeSummaries || prepared.visualDescriptions !== rec.visualDescriptions) {
        const latest = await docStore.get(rec.id);
        signal.throwIfAborted();
        if (!latest || latest.text !== rec.text) throw new Error("The document changed. Open it again to continue.");
        // Retain concurrent summary/metadata edits when saving derived narration.
        prepared = { ...(latest ?? rec), ...(opts.persist ? rec : {}), patois: prepared.patois, codeSummaries: { ...latest.codeSummaries, ...prepared.codeSummaries }, visualDescriptions: { ...latest.visualDescriptions, ...prepared.visualDescriptions } };
        await docStore.put(prepared);
      }
      signal.throwIfAborted();
      engine.load(doc, index, offset);
      engine.setSpeed(get().speed || useSettings.getState().defaultSpeed);
      set({ doc, record: prepared, voiceId: voice.id, summary, menuOpen: false, focus: false, offline: get().offline && !isLocalVoice(voice.id) });
      const requests = engine.passages.map((p) => ({ text: p.text, voice: voice.id, engine: voice.engine, profile: voice.kind === "profile" }));
      const autoPrepare = opts.prepare && usesBuiltInProxy() && voice.engine !== LOCAL_ENGINE
        && !isPaidEngine(voice.engine) && useSettings.getState().engine !== LOCAL_ENGINE && !get().offline;
      if (autoPrepare || hasActivePreparation(preparationRequests(requests))) void get().prerender();
      if (opts.autoplay) void engine.play();
      // Reading starts with captions and alt text; descriptions replace them as they arrive.
      if (readingBlocks(readingText).some((block) => block.kind === "visual")) {
        describing = new AbortController();
        void describeVisuals(rec.id, prepared, readingText, !!autoPrepare, describing.signal);
      }
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
      set({ prerendering: { done: 0, total: engine.passages.length } });
      try {
        let completed = 0;
        await engine.prepare((done, total) => {
          completed = Math.max(completed, done);
          if (prerendering === controller) set({ prerendering: { done: completed, total } });
        }, controller.signal);
        if (!controller.signal.aborted && get().doc === doc) {
          if (describingDeck === doc.id) heldBack = doc.id;
          else toast(PREPARED);
        }
      } catch (error) {
        if (!controller.signal.aborted) toast(`Audio preparation failed: ${error instanceof Error ? error.message : "Please retry."}`);
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
      describing?.abort();
      describing = null;
      get().cancelPreparation();
      get().cancelPrerender();
      engine.unload();
      set({ doc: null, record: null, summary: false, focus: false, menuOpen: false, speechError: null });
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
          return get().open(next, { autoplay: wasPlaying, resume: variant(v.id) === variant(get().voiceId), persist: true, summary: get().summary });
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
