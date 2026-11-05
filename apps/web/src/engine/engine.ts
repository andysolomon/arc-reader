import type { WordTiming } from "../lib/db";
import { estimateDuration, type Segmented, type Sentence } from "../lib/segment";
import { synthesize } from "./providers";
import type { Chunk, ProviderId } from "./types";

export interface EngineDoc extends Segmented {
  id: string;
  title: string;
  voice: string;
  lang: string;
}

export interface EngineSnapshot {
  docId: string | null;
  index: number;
  wordIndex: number;
  /** seconds into the current sentence at 1× */
  offset: number;
  playing: boolean;
  /** waiting on the first chunk */
  loading: boolean;
  speed: number;
  /** 1× seconds */
  elapsed: number;
  total: number;
  /** 0..1 */
  fraction: number;
  /** sentence boundaries as fractions */
  ticks: number[];
  source: Chunk["source"] | null;
  ended: boolean;
}

export interface EngineOptions {
  provider: () => ProviderId;
  offline: () => boolean;
  onOffline: () => void;
  onOnline: () => void;
  onPersist: (snap: EngineSnapshot) => void;
  onError: (message: string) => void;
}

type Listener = (s: EngineSnapshot) => void;

const PREFETCH = 2;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Sentence-level playback engine.
 * - One audio element per sentence chunk; the next two are prefetched.
 * - Advances with requestAnimationFrame using real elapsed time (never a fixed step).
 * - When audio exists, audio.currentTime is the source of truth; otherwise the
 *   clock runs on the estimate (2.83 words/s × speed) or follows Web Speech boundaries.
 */
export class PlaybackEngine {
  private doc: EngineDoc | null = null;
  private durations: number[] = [];
  private chunks = new Map<number, Promise<Chunk>>();
  private current: Chunk | null = null;
  private index = 0;
  private offset = 0;
  private wordIndex = -1;
  private playing = false;
  private loading = false;
  private ended = false;
  private speed = 1;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private utter: SpeechSynthesisUtterance | null = null;
  private utterWordBase = 0;
  private raf = 0;
  private last = 0;
  private token = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private snap: EngineSnapshot = PlaybackEngine.empty();

  constructor(private opts: EngineOptions) {}

  static empty(): EngineSnapshot {
    return { docId: null, index: 0, wordIndex: -1, offset: 0, playing: false, loading: false, speed: 1, elapsed: 0, total: 0, fraction: 0, ticks: [], source: null, ended: false };
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snap);
    return () => void this.listeners.delete(fn);
  }

  getSnapshot() {
    return this.snap;
  }

  get sentences(): Sentence[] {
    return this.doc?.sentences ?? [];
  }

  /** Load a document. Does not start playback (no autoplay without a gesture). */
  load(doc: EngineDoc, index = 0, offset = 0) {
    this.stopMedia();
    this.token++;
    this.doc = doc;
    this.chunks.clear();
    this.current = null;
    this.durations = doc.sentences.map((s) => estimateDuration(s.words));
    this.index = Math.max(0, Math.min(doc.sentences.length - 1, index));
    this.offset = Math.max(0, offset);
    this.wordIndex = -1;
    this.playing = false;
    this.loading = false;
    this.ended = false;
    this.emit();
  }

  unload() {
    this.stopMedia();
    this.token++;
    this.doc = null;
    this.chunks.clear();
    this.current = null;
    this.durations = [];
    this.index = 0;
    this.offset = 0;
    this.playing = false;
    this.loading = false;
    this.ended = false;
    this.emit();
  }

  /** Change voice for the loaded document (clears prepared chunks). */
  setVoice(voice: string, lang: string) {
    if (!this.doc) return;
    const wasPlaying = this.playing;
    this.doc = { ...this.doc, voice, lang };
    this.chunks.clear();
    this.stopMedia();
    this.current = null;
    if (wasPlaying) void this.play();
    else this.emit();
  }

  setSpeed(v: number) {
    this.speed = v;
    if (this.audio) this.audio.playbackRate = v;
    if (this.utter && this.playing) {
      // Web Speech cannot change rate mid-utterance: restart from the current word.
      this.startLocal(this.current!, this.token);
    }
    this.emit();
  }

  async play() {
    if (!this.doc || !this.doc.sentences.length) return;
    if (this.ended || (this.index >= this.doc.sentences.length - 1 && this.offset >= this.durations[this.index])) {
      this.index = 0;
      this.offset = 0;
      this.ended = false;
    }
    this.playing = true;
    const token = ++this.token;
    this.stopMedia();
    const pending = !this.chunks.has(this.index);
    if (pending) {
      this.loading = true;
      this.emit();
    }
    let chunk: Chunk;
    try {
      chunk = await this.ensureChunk(this.index);
    } catch (e) {
      if (token !== this.token) return;
      this.loading = false;
      this.playing = false;
      this.opts.onError((e as Error).message || "Could not prepare audio");
      this.emit();
      return;
    }
    if (token !== this.token) return;
    this.loading = false;
    this.current = chunk;
    if (chunk.duration > 0) this.durations[this.index] = chunk.duration;
    this.prefetch();
    this.startChunk(chunk, token);
    this.last = now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    this.emit();
  }

  pause() {
    this.playing = false;
    this.stopMedia();
    this.emit();
    this.persistSoon(0);
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  stop() {
    this.pause();
    this.index = 0;
    this.offset = 0;
    this.wordIndex = -1;
    this.ended = false;
    this.emit();
  }

  /** Seek to a sentence. Starts playback (click/arrow on a sentence means "read from here"). */
  seek(i: number, autoplay = true) {
    if (!this.doc) return;
    i = Math.max(0, Math.min(this.doc.sentences.length - 1, i));
    this.index = i;
    this.offset = 0;
    this.wordIndex = -1;
    this.ended = false;
    if (autoplay || this.playing) void this.play();
    else {
      this.stopMedia();
      this.emit();
    }
    this.persistSoon();
  }

  seekFraction(f: number, autoplay = true) {
    if (!this.doc) return;
    const total = this.total();
    let target = Math.max(0, Math.min(1, f)) * total;
    let i = 0;
    while (i < this.durations.length - 1 && target >= this.durations[i]) {
      target -= this.durations[i];
      i++;
    }
    this.index = i;
    this.offset = Math.min(target, this.durations[i]);
    this.wordIndex = -1;
    this.ended = false;
    if (autoplay || this.playing) void this.play();
    else {
      this.stopMedia();
      this.emit();
    }
    this.persistSoon();
  }

  prev() {
    // Within the first second of a sentence, go to the previous one; otherwise restart this one.
    this.seek(this.offset < 1 ? this.index - 1 : this.index);
  }

  next() {
    if (!this.doc) return;
    if (this.index >= this.doc.sentences.length - 1) return;
    this.seek(this.index + 1);
  }

  /** Fetch every chunk (for download). Resolves to the audio blobs in order, or null when a sentence has no audio. */
  async collectAudio(onProgress?: (done: number, total: number) => void): Promise<(Blob | null)[]> {
    if (!this.doc) return [];
    const out: (Blob | null)[] = [];
    for (let i = 0; i < this.doc.sentences.length; i++) {
      const c = await this.ensureChunk(i);
      out.push(c.audio ?? null);
      onProgress?.(i + 1, this.doc.sentences.length);
    }
    return out;
  }

  // ---- internals ----

  private total() {
    return this.durations.reduce((a, b) => a + b, 0);
  }

  private ensureChunk(i: number): Promise<Chunk> {
    const doc = this.doc!;
    let p = this.chunks.get(i);
    if (!p) {
      const s = doc.sentences[i];
      p = synthesize({
        text: s.text,
        voice: doc.voice,
        provider: this.opts.provider(),
        forceLocal: this.opts.offline() || doc.voice === "piper",
        onOffline: this.opts.onOffline,
        onOnline: this.opts.onOnline,
      }).then((c) => {
        if (c.duration > 0 && this.doc === doc) this.durations[i] = c.duration;
        return c;
      });
      this.chunks.set(i, p);
      p.catch(() => this.chunks.delete(i));
    }
    return p;
  }

  private prefetch() {
    if (!this.doc) return;
    for (let k = 1; k <= PREFETCH; k++) {
      const i = this.index + k;
      if (i < this.doc.sentences.length) void this.ensureChunk(i).catch(() => {});
    }
  }

  private startChunk(chunk: Chunk, token: number) {
    if (chunk.audio) this.startAudio(chunk, token);
    else if (chunk.source === "local") this.startLocal(chunk, token);
    // "estimate": the rAF clock alone drives progress.
  }

  private startAudio(chunk: Chunk, token: number) {
    const url = URL.createObjectURL(chunk.audio!);
    const a = new Audio(url);
    this.audio = a;
    this.audioUrl = url;
    a.preload = "auto";
    a.playbackRate = this.speed;
    a.onloadedmetadata = () => {
      if (token !== this.token) return;
      if (Number.isFinite(a.duration) && a.duration > 0) this.durations[this.index] = a.duration;
      if (this.offset > 0) a.currentTime = Math.min(this.offset, a.duration - 0.05);
    };
    a.onended = () => {
      if (token === this.token) this.advance();
    };
    a.onerror = () => {
      if (token === this.token) this.advance();
    };
    a.play().catch((e: Error) => {
      if (token !== this.token) return;
      this.playing = false;
      this.stopMedia();
      this.opts.onError(e.name === "NotAllowedError" ? "Tap play to start listening" : "Audio playback failed");
      this.emit();
    });
  }

  private startLocal(_chunk: Chunk, token: number) {
    const s = this.doc!.sentences[this.index];
    const synth = window.speechSynthesis;
    synth.cancel();
    // Start from the current word so seeks/offsets and speed changes resume in place.
    const startWord = Math.max(0, Math.min(s.words.length - 1, this.wordFromOffset(this.offset, s.words.length, undefined)));
    const text = s.words.slice(startWord).join(" ");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.doc!.lang;
    u.rate = Math.max(0.1, Math.min(10, this.speed));
    const voices = synth.getVoices();
    const match = voices.find((v) => v.lang.replace("_", "-").toLowerCase() === this.doc!.lang.toLowerCase()) ?? voices.find((v) => v.lang.startsWith(this.doc!.lang.slice(0, 2)));
    if (match) u.voice = match;
    this.utterWordBase = startWord;
    // Snap the clock to the start of that word.
    this.offset = (startWord / s.words.length) * this.durations[this.index];
    const starts: number[] = [];
    let acc = 0;
    for (const w of s.words.slice(startWord)) {
      starts.push(acc);
      acc += w.length + 1;
    }
    u.onboundary = (e) => {
      if (token !== this.token || e.name !== "word") return;
      let wi = 0;
      while (wi < starts.length - 1 && starts[wi + 1] <= e.charIndex) wi++;
      const abs = this.utterWordBase + wi;
      // Keep the clock honest: align offset to the word the engine is actually speaking.
      this.offset = Math.max(this.offset, (abs / s.words.length) * this.durations[this.index]);
      this.wordIndex = abs;
    };
    u.onend = () => {
      if (token !== this.token || this.utter !== u) return;
      this.utter = null;
      this.advance();
    };
    u.onerror = (e) => {
      if (token !== this.token || this.utter !== u) return;
      this.utter = null;
      if (e.error === "interrupted" || e.error === "canceled") return;
      // Fall back to the silent estimate clock for this sentence.
    };
    this.utter = u;
    synth.speak(u);
  }

  private stopMedia() {
    cancelAnimationFrame(this.raf);
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    if (this.utter) {
      this.utter.onend = null;
      this.utter.onboundary = null;
      this.utter = null;
      window.speechSynthesis?.cancel();
    }
  }

  private loop = (t: number) => {
    if (!this.playing || !this.doc) return;
    const dt = Math.min(1, (t - this.last) / 1000);
    this.last = t;
    const dur = this.durations[this.index] || 0.01;
    if (this.audio && !this.audio.paused && this.audio.readyState >= 2) {
      this.offset = this.audio.currentTime;
    } else if (!this.utter) {
      this.offset += dt * this.speed;
    } else {
      // Web Speech: the estimate clock keeps the word underline moving between boundary events,
      // but never runs past the end; onend advances.
      this.offset = Math.min(this.offset + dt * this.speed, dur - 0.001);
    }
    if (!this.audio && !this.utter && this.offset >= dur) {
      this.advance();
      return;
    }
    const s = this.doc.sentences[this.index];
    const w = this.wordFromOffset(this.offset, s.words.length, this.current?.words);
    if (!this.utter || w > this.wordIndex) this.wordIndex = w;
    this.emit();
    this.raf = requestAnimationFrame(this.loop);
  };

  private wordFromOffset(offset: number, n: number, words?: WordTiming[]): number {
    if (n === 0) return -1;
    if (words && words.length) {
      let i = 0;
      while (i < words.length - 1 && offset >= words[i + 1].start) i++;
      return Math.min(n - 1, i);
    }
    const dur = this.durations[this.index] || estimateDuration(n);
    return Math.max(0, Math.min(n - 1, Math.floor((offset / dur) * n)));
  }

  private advance() {
    if (!this.doc) return;
    this.stopMedia();
    if (this.index >= this.doc.sentences.length - 1) {
      this.offset = this.durations[this.index];
      this.playing = false;
      this.ended = true;
      this.wordIndex = -1;
      this.emit();
      this.persistSoon(0);
      return;
    }
    this.index++;
    this.offset = 0;
    this.wordIndex = -1;
    this.persistSoon();
    void this.play();
  }

  private persistSoon(delay = 800) {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.doc) this.opts.onPersist(this.snap);
    }, delay);
  }

  private emit() {
    const total = this.total();
    let elapsed = 0;
    for (let i = 0; i < this.index; i++) elapsed += this.durations[i];
    elapsed += Math.min(this.offset, this.durations[this.index] ?? 0);
    let acc = 0;
    const ticks: number[] = [];
    for (let i = 0; i < this.durations.length - 1; i++) {
      acc += this.durations[i];
      ticks.push(acc / total);
    }
    this.snap = {
      docId: this.doc?.id ?? null,
      index: this.index,
      wordIndex: this.wordIndex,
      offset: this.offset,
      playing: this.playing,
      loading: this.loading,
      speed: this.speed,
      elapsed,
      total,
      fraction: total > 0 ? elapsed / total : 0,
      ticks,
      source: this.current?.source ?? null,
      ended: this.ended,
    };
    for (const l of this.listeners) l(this.snap);
  }
}
