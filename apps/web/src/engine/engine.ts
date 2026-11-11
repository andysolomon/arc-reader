import type { PluginListenerHandle } from "@capacitor/core";
import type { WordTiming } from "../lib/db";
import { listenDeviceSpeech, speakOnDevice, stopDeviceSpeech } from "../lib/deviceSpeech";
import { isNativeApp } from "../lib/native";
import { estimateDuration, planPassages, type Passage, type Segmented, type Sentence } from "../lib/segment";
import { isPaidEngine, synthesize, type SynthOptions } from "./providers";
import { ApiBusy, ApiRejected, ApiUnreachable, LOCAL_ENGINE, type Chunk, type EngineId } from "./types";

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
  /** Audio is actually running. Never true while a sentence is still being generated. */
  playing: boolean;
  /** Waiting on the current sentence's audio (initial start, or a gap between sentences). */
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
  /** Times the place was set rather than read to: a load, a seek, or a restart. */
  seeks: number;
}

export interface EngineOptions {
  /** Engine for a voice: presets name their own, cloned profiles use the chosen one, local is local */
  engine: (voiceId: string) => EngineId;
  wordTimings: () => boolean;
  /** OpenAI model for OpenAI voices (see openaiModelFor) */
  openaiModel?: () => string;
  isProfileVoice: (voiceId: string) => boolean;
  offline: () => boolean;
  /** Submit all passages as one server-owned job before hydrating the local cache. */
  prepareAudio?: (requests: SynthOptions[], start: number, progress?: (done: number, total: number) => void, signal?: AbortSignal) => Promise<void>;
  onRejected: (message: string) => void;
  onOffline: () => void;
  onOnline: () => void;
  onPersist: (snap: EngineSnapshot) => void;
  onError: (message: string) => void;
  /**
   * The chosen voice could not be generated (server down, busy, or rejecting).
   * Playback stops; the host decides whether to retry or switch to the browser voice.
   */
  onUnavailable: (message: string) => void;
  /** Once per load: the voice generates slower than it plays (factor = render seconds ÷ audio seconds), so playback will stall between sentences. */
  onSlow: (factor: number) => void;
}

type Listener = (s: EngineSnapshot) => void;

/** Human message for a failed generation. */
export function unavailableMessage(e: unknown): string {
  if (e instanceof ApiUnreachable) return "Speech server unreachable.";
  if (e instanceof ApiBusy) return "The speech server is busy.";
  if (e instanceof ApiRejected) return e.message;
  return (e as Error)?.message || "Could not prepare audio.";
}

/** Listening time (seconds at the current speed) kept generated past the current passage. */
const PREFETCH_SECONDS = 60;
/** Passages always kept ahead however long they are, and the most prefetch requests outstanding at once. */
const PREFETCH_PASSAGES = 2;
/** Paid engines keep up and bill audio that a pause or skip never plays: just the next passage. */
const PAID_PREFETCH = 1;
/** Render time ÷ audio time above which a voice cannot keep up with playback. */
export const SLOW_FACTOR = 1.5;
/** Seconds of a clip's trailing silence that are still played before the next passage starts. */
const TAIL_KEEP = 0.25;
/** A passage never plays below this share of its own level when matched to its neighbours (−6 dB). */
const MIN_GAIN = 0.5;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Passage-level playback engine with sentence-level position.
 * - One request and one audio element per passage (a run of sentences, see planPassages);
 *   about a minute of listening is prefetched (see prefetch). The reader still moves sentence by sentence:
 *   each clip carries its sentence starts, and crossing one advances the index without
 *   touching the audio.
 * - Advances with requestAnimationFrame using real elapsed time (never a fixed step).
 * - When audio exists, audio.currentTime is the source of truth; otherwise the
 *   clock runs on the estimate (2.83 words/s × speed) or follows Web Speech boundaries.
 */
export class PlaybackEngine {
  private doc: EngineDoc | null = null;
  private durations: number[] = [];
  private passageList: Passage[] = [];
  /** Sentence index → passage index */
  private passageOf: number[] = [];
  private chunks = new Map<number, Promise<Chunk>>();
  /** Prefetch requests outstanding; the generation drops callbacks from before a load or voice change. */
  private prefetching = 0;
  private prefetchGen = 0;
  private current: Chunk | null = null;
  /** Quietest passage level heard so far (dBFS); louder passages are brought down to it. */
  private levelRef: number | null = null;
  private timingsFor = -1;
  private timings: WordTiming[] | undefined;
  private index = 0;
  private offset = 0;
  private wordIndex = -1;
  private seeks = 0;
  private playing = false;
  private loading = false;
  private ended = false;
  private slowNoted = false;
  private speed = 1;
  /** Keep the user's playback permission across passages; some browsers grant it per element. */
  private audioElement: HTMLAudioElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private utter: SpeechSynthesisUtterance | null = null;
  private utterWordBase = 0;
  /** On-device utterance in flight (iOS). The estimate clock highlights words; the native callback advances. */
  private nativeSpeech = false;
  private deviceGen = 0;
  private boundaryHandle: PluginListenerHandle | null = null;
  private raf = 0;
  private last = 0;
  private token = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private snap: EngineSnapshot = PlaybackEngine.empty();

  constructor(private opts: EngineOptions) {}

  static empty(): EngineSnapshot {
    return { docId: null, index: 0, wordIndex: -1, offset: 0, playing: false, loading: false, speed: 1, elapsed: 0, total: 0, fraction: 0, ticks: [], source: null, ended: false, seeks: 0 };
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

  get passages(): Passage[] {
    return this.passageList;
  }

  /** Load a document. Does not start playback (no autoplay without a gesture). */
  load(doc: EngineDoc, index = 0, offset = 0) {
    this.stopMedia();
    this.token++;
    this.doc = doc;
    this.chunks.clear();
    this.resetPrefetch();
    this.current = null;
    this.levelRef = null;
    this.timingsFor = -1;
    this.durations = doc.sentences.map((s) => estimateDuration(s.words));
    this.passageList = planPassages(doc.sentences);
    this.passageOf = [];
    for (const p of this.passageList) for (let i = p.start; i < p.end; i++) this.passageOf[i] = p.index;
    this.index = Math.max(0, Math.min(doc.sentences.length - 1, index));
    this.offset = Math.max(0, offset);
    this.wordIndex = -1;
    this.playing = false;
    this.loading = false;
    this.ended = false;
    this.slowNoted = false;
    this.seeks++;
    this.emit();
  }

  /**
   * Swap in new wording for the loaded document without moving the playhead, such as image
   * descriptions that arrived after reading began. Sentences and passages must line up with
   * the loaded ones. Changed passages are generated again, except one already playing.
   */
  replaceText(doc: EngineDoc): boolean {
    const old = this.doc;
    if (!old || old.id !== doc.id || old.sentences.length !== doc.sentences.length
      || old.sentences.some((s, i) => s.para !== doc.sentences[i].para)) return false;
    const before = this.passageList;
    const passages = planPassages(doc.sentences);
    if (passages.length !== before.length || passages.some((p, i) => p.start !== before[i].start || p.end !== before[i].end)) return false;
    const keep = this.playing ? this.passageOf[this.index] : -1;
    this.doc = doc;
    this.passageList = passages;
    for (const p of passages) {
      if (p.text === before[p.index].text) continue;
      for (let s = p.start; s < p.end; s++) this.durations[s] = estimateDuration(doc.sentences[s].words);
      if (p.index !== keep) this.chunks.delete(p.index);
    }
    this.resetPrefetch();
    if (this.playing) this.prefetch();
    this.emit();
    return true;
  }

  unload() {
    this.stopMedia();
    this.token++;
    this.doc = null;
    this.chunks.clear();
    this.resetPrefetch();
    this.current = null;
    this.passageList = [];
    this.passageOf = [];
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
    this.resetPrefetch();
    this.stopMedia();
    this.current = null;
    this.levelRef = null;
    this.timingsFor = -1;
    this.slowNoted = false;
    if (wasPlaying) void this.play();
    else this.emit();
  }

  setSpeed(v: number) {
    this.speed = v;
    if (this.audio) this.audio.playbackRate = v;
    if ((this.utter || this.nativeSpeech) && this.playing) {
      // Neither Web Speech nor AVSpeech can change rate mid-utterance: restart from the current word.
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
      this.seeks++;
    }
    const token = ++this.token;
    this.stopMedia();
    const passage = this.passageOf[this.index];
    const pending = !this.chunks.has(passage);
    if (pending) {
      // Nothing plays until this passage's audio exists: `playing` stays as it was
      // (false from a cold start, true between passages) and the clock is frozen so
      // the wait is not counted as listening time.
      this.loading = true;
      cancelAnimationFrame(this.raf);
      this.emit();
    }
    let chunk: Chunk;
    try {
      chunk = await this.ensureChunk(passage);
    } catch (e) {
      if (token !== this.token) return;
      this.loading = false;
      this.playing = false;
      this.emit();
      this.persistSoon(0);
      this.opts.onUnavailable(unavailableMessage(e));
      return;
    }
    if (token !== this.token) return;
    this.loading = false;
    this.playing = true;
    this.current = chunk;
    this.timingsFor = -1;
    this.prefetch();
    this.startChunk(chunk, token);
    this.last = now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    this.emit();
  }

  pause() {
    // Animation frames may be suspended while audio keeps playing in a background tab.
    this.readAudioPosition();
    // Bumping the token discards a sentence that is still being generated.
    this.token++;
    this.playing = false;
    this.loading = false;
    this.stopMedia();
    this.emit();
    this.persistSoon(0);
  }

  toggle() {
    if (this.playing || this.loading) this.pause();
    else void this.play();
  }

  stop() {
    this.pause();
    this.index = 0;
    this.offset = 0;
    this.wordIndex = -1;
    this.ended = false;
    this.seeks++;
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
    this.seeks++;
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
    this.seeks++;
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

  /**
   * Render every passage into the cache, from the current one to the end and then
   * from the start, so a slow engine never stalls playback. Safe alongside playback:
   * the server job owns generation and the browser hydrates completed clips.
   */
  async prepare(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const n = this.passageList.length;
    const start = this.passageOf[this.index] ?? 0;
    if (this.opts.prepareAudio) {
      await this.opts.prepareAudio(this.passageList.map((_, i) => this.requestFor(i)), start, onProgress, signal);
    }
    for (let k = 0; k < n; k++) {
      if (signal?.aborted || this.doc !== doc) return;
      await this.ensureChunk((start + k) % n);
      if (signal?.aborted || this.doc !== doc) return;
      onProgress?.(k + 1, n);
    }
  }

  /** Fetch every passage (for download). Resolves to the audio blobs in order, or null when a passage has no audio. */
  async collectAudio(onProgress?: (done: number, total: number) => void): Promise<(Blob | null)[]> {
    if (!this.doc) return [];
    const out: (Blob | null)[] = [];
    for (let i = 0; i < this.passageList.length; i++) {
      const c = await this.ensureChunk(i);
      out.push(c.audio ?? null);
      onProgress?.(i + 1, this.passageList.length);
    }
    return out;
  }

  // ---- internals ----

  private total() {
    return this.durations.reduce((a, b) => a + b, 0);
  }

  private passageAt(sentence: number): Passage {
    return this.passageList[this.passageOf[sentence]];
  }

  /** Where a sentence starts inside its passage's clip, in seconds. */
  private clipStart(chunk: Chunk, sentence: number): number {
    return chunk.starts?.[sentence - this.passageAt(sentence).start] ?? 0;
  }

  /** Per-sentence durations from a passage clip's sentence starts (a one-sentence passage is the whole clip). */
  private applyDurations(passage: Passage, c: Chunk) {
    if (!(c.duration > 0)) return;
    const n = passage.end - passage.start;
    const starts = c.starts && c.starts.length === n ? c.starts : null;
    if (!starts) {
      if (n === 1) this.durations[passage.start] = c.duration;
      return;
    }
    for (let k = 0; k < n; k++) {
      const d = (k + 1 < n ? starts[k + 1] : c.duration) - starts[k];
      if (d > 0) this.durations[passage.start + k] = d;
    }
  }

  private ensureChunk(passage: number): Promise<Chunk> {
    const doc = this.doc!;
    let p = this.chunks.get(passage);
    if (!p) {
      const g = this.passageList[passage];
      p = synthesize(this.requestFor(passage)).then((c) => {
        if (this.doc === doc) {
          this.applyDurations(g, c);
          this.noteSpeed(c);
          // Progress bar and ticks follow the measured clip, also while paused or preparing.
          if (!this.playing) this.emit();
        }
        return c;
      });
      this.chunks.set(passage, p);
      p.catch(() => { if (this.chunks.get(passage) === p) this.chunks.delete(passage); });
    }
    return p;
  }

  private requestFor(passage: number): SynthOptions {
    const doc = this.doc!;
    const g = this.passageList[passage];
    return {
      text: g.text,
      voice: doc.voice,
      engine: this.opts.engine(doc.voice),
      openaiModel: this.opts.openaiModel?.(),
      docId: doc.id,
      profile: this.opts.isProfileVoice(doc.voice),
      wordTimings: this.opts.wordTimings(),
      words: g.parts.flat(),
      parts: g.parts,
      sentences: doc.sentences.slice(g.start, g.end).map((s) => s.text),
      forceLocal: this.opts.offline() || doc.voice === "local" || this.opts.engine(doc.voice) === LOCAL_ENGINE,
      fallbackLocal: false,
      onOffline: this.opts.onOffline,
      onOnline: this.opts.onOnline,
      onRejected: this.opts.onRejected,
    };
  }

  /**
   * Level matching: each voice generation lands at a slightly different loudness.
   * The element can only turn a clip down, so every passage is brought down to the
   * quietest one heard so far (within MIN_GAIN), which keeps joins from popping.
   */
  private gainFor(chunk: Chunk): number {
    if (chunk.loudness === undefined || !Number.isFinite(chunk.loudness)) return 1;
    this.levelRef = this.levelRef === null ? chunk.loudness : Math.min(this.levelRef, chunk.loudness);
    return Math.max(MIN_GAIN, Math.min(1, 10 ** ((this.levelRef - chunk.loudness) / 20)));
  }

  /** The current sentence's word timings, relative to the sentence's start in the clip. */
  private sentenceTimings(): WordTiming[] | undefined {
    if (this.timingsFor === this.index) return this.timings;
    this.timingsFor = this.index;
    this.timings = undefined;
    const c = this.current;
    if (!c?.words?.length) return undefined;
    const g = this.passageAt(this.index);
    let from = 0;
    for (let k = g.start; k < this.index; k++) from += g.parts[k - g.start].length;
    const n = g.parts[this.index - g.start].length;
    const base = this.clipStart(c, this.index);
    const slice = c.words.slice(from, from + n);
    if (slice.length !== n) return undefined;
    this.timings = slice.map((w) => ({ start: w.start - base, end: w.end - base }));
    return this.timings;
  }

  private noteSpeed(c: Chunk) {
    if (this.slowNoted || !c.renderSeconds || c.duration <= 0) return;
    const factor = c.renderSeconds / c.duration;
    if (factor < SLOW_FACTOR) return;
    this.slowNoted = true;
    this.opts.onSlow(Math.round(factor));
  }

  /**
   * Keep PREFETCH_SECONDS of listening generated past the current passage. Counting
   * time rather than passages lets long paragraphs, which a slow voice renders faster
   * than they play, bank enough to cover runs of headings and dialogue, which it does
   * not (each request carries a fixed overhead). Refills as each clip arrives, at most
   * PREFETCH_PASSAGES requests at a time, so a seek on the single-worker server waits
   * behind no more stale clips than before. Paid engines keep just PAID_PREFETCH.
   */
  private prefetch() {
    if (!this.doc) return;
    const gen = this.prefetchGen;
    const paid = isPaidEngine(this.opts.engine(this.doc.voice));
    const passages = paid ? PAID_PREFETCH : PREFETCH_PASSAGES;
    const target = paid ? 0 : PREFETCH_SECONDS * this.speed;
    let ahead = 0;
    for (let i = this.passageOf[this.index] + 1, n = 0; i < this.passageList.length && (n < passages || ahead < target); i++, n++) {
      if (!this.chunks.has(i)) {
        if (this.prefetching >= PREFETCH_PASSAGES) return;
        this.prefetching++;
        void this.ensureChunk(i).then(() => true, () => false).then((ok) => {
          if (gen !== this.prefetchGen) return;
          this.prefetching--;
          // A failure stops the refill; the next passage start tries again.
          if (ok) this.prefetch();
        });
      }
      const g = this.passageList[i];
      for (let s = g.start; s < g.end; s++) ahead += this.durations[s];
    }
  }

  private resetPrefetch() {
    this.prefetchGen++;
    this.prefetching = 0;
  }

  private startChunk(chunk: Chunk, token: number) {
    if (chunk.audio) this.startAudio(chunk, token);
    else if (chunk.source === "local") this.startLocal(chunk, token);
    // "estimate": the rAF clock alone drives progress.
  }

  private startAudio(chunk: Chunk, token: number) {
    const url = URL.createObjectURL(chunk.audio!);
    const a = this.audioElement ??= new Audio();
    this.audio = a;
    this.audioUrl = url;
    const active = () => token === this.token && this.audio === a && this.audioUrl === url;
    const failed = (message: string) => {
      if (!active()) return;
      this.pause();
      this.opts.onError(message);
    };
    a.preload = "auto";
    a.volume = this.gainFor(chunk);
    const passage = this.passageAt(this.index);
    let at = this.clipStart(chunk, this.index) + this.offset;
    // From the top of a clip, skip the encoder's leading silence so passages join without a dead gap.
    if (this.index === passage.start && this.offset === 0 && chunk.lead) at = Math.max(0, chunk.lead - 0.05);
    a.onloadedmetadata = () => {
      if (!active()) return;
      if (passage.end - passage.start === 1 && Number.isFinite(a.duration) && a.duration > 0) this.durations[this.index] = a.duration;
      if (at > 0) a.currentTime = Math.max(0, Math.min(at, a.duration - 0.05));
    };
    a.ontimeupdate = () => {
      if (!active() || !this.playing) return;
      // Media events keep passage handoffs and position working without animation frames.
      if (!this.updateAudio()) this.emit();
    };
    a.onended = () => {
      if (active()) this.finishPassage();
    };
    a.onerror = () => {
      failed("Audio playback failed. Tap play to retry.");
    };
    a.src = url;
    a.load();
    a.playbackRate = this.speed;
    a.play().catch((e: Error) => {
      failed(e.name === "NotAllowedError" ? "Tap play to start listening" : "Audio playback failed. Tap play to retry.");
    });
  }

  private startLocal(_chunk: Chunk, token: number) {
    if (isNativeApp()) {
      this.startDeviceVoice(token);
      return;
    }
    this.startWebSpeech(token);
  }

  /** AVSpeechSynthesizer. Word ranges drive the highlight; the promise advances the sentence. */
  private startDeviceVoice(token: number) {
    const doc = this.doc;
    if (!doc) return;
    const s = doc.sentences[this.index];
    const startWord = Math.max(0, Math.min(s.words.length - 1, this.wordFromOffset(this.offset, s.words.length, undefined)));
    const words = s.words.slice(startWord);
    const text = words.join(" ");
    const starts: number[] = [];
    let acc = 0;
    for (const w of words) {
      starts.push(acc);
      acc += w.length + 1;
    }
    this.nativeSpeech = true;
    this.utterWordBase = startWord;
    this.offset = (startWord / Math.max(1, s.words.length)) * this.durations[this.index];
    const gen = ++this.deviceGen;
    void this.bindDeviceSpeech(text, doc.lang || "en-US", starts, token, gen);
  }

  private async bindDeviceSpeech(text: string, lang: string, starts: number[], token: number, gen: number) {
    const alive = () => gen === this.deviceGen && token === this.token && this.nativeSpeech;
    try {
      // A speed change stops the previous utterance before the next one starts, so the two cannot overlap.
      await stopDeviceSpeech().catch(() => undefined);
      if (!alive()) return;
      this.boundaryHandle = await listenDeviceSpeech((charIndex) => {
        if (!alive() || !this.doc) return;
        let wi = 0;
        while (wi < starts.length - 1 && starts[wi + 1] <= charIndex) wi++;
        const abs = this.utterWordBase + wi;
        const n = this.doc.sentences[this.index]?.words.length ?? 1;
        this.offset = Math.max(this.offset, (abs / n) * this.durations[this.index]);
        this.wordIndex = abs;
        this.emit();
      });
      if (!alive()) return;
      if (text.trim()) await speakOnDevice(text, lang, Math.max(0.1, Math.min(10, this.speed)));
      if (!alive()) return;
      this.nativeSpeech = false;
      this.advance();
    } catch {
      if (!alive()) return;
      this.nativeSpeech = false;
      // WKWebView's Web Speech API can stay silent and never end the utterance.
      // The estimate clock finishes this sentence instead.
    }
  }

  private startWebSpeech(token: number) {
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
      this.audio.onloadedmetadata = null;
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
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
    if (this.nativeSpeech || this.boundaryHandle) {
      this.nativeSpeech = false;
      this.deviceGen++;
      const handle = this.boundaryHandle;
      this.boundaryHandle = null;
      void handle?.remove();
      void stopDeviceSpeech();
    }
  }

  /** Read the media clock even when the UI has not received an animation frame. */
  private readAudioPosition() {
    if (!this.audio || this.audio.readyState < 2 || !this.current || !this.doc) return;
    const t = this.audio.currentTime;
    const c = this.current;
    const g = this.passageAt(this.index);
    while (this.index + 1 < g.end && c.starts && t >= c.starts[this.index + 1 - g.start]) {
      this.index++;
      this.wordIndex = -1;
      this.persistSoon();
    }
    this.offset = Math.max(0, t - this.clipStart(c, this.index));
    this.wordIndex = this.wordFromOffset(this.offset, this.doc.sentences[this.index].words.length, this.sentenceTimings());
  }

  /** Returns true when trimming trailing silence has handed off to another passage. */
  private updateAudio(): boolean {
    if (!this.audio || this.audio.paused || this.audio.readyState < 2) return false;
    this.readAudioPosition();
    const c = this.current!;
    if (c.tail && c.tail > TAIL_KEEP && this.audio.currentTime >= c.duration - c.tail + TAIL_KEEP) {
      this.finishPassage();
      return true;
    }
    return false;
  }

  private loop = (t: number) => {
    if (!this.playing || !this.doc) return;
    const dt = Math.min(1, (t - this.last) / 1000);
    this.last = t;
    const dur = this.durations[this.index] || 0.01;
    if (this.audio) {
      // A paused or buffering element must never advance on an estimated clock.
      if (this.updateAudio()) return;
    } else if (!this.utter && !this.nativeSpeech) {
      this.offset += dt * this.speed;
    } else {
      // Spoken locally: the estimate clock keeps the word underline moving between boundary
      // events, but never runs past the end. The utterance ending advances the sentence.
      this.offset = Math.min(this.offset + dt * this.speed, dur - 0.001);
    }
    if (!this.audio && !this.utter && !this.nativeSpeech && this.offset >= dur) {
      this.advance();
      return;
    }
    const s = this.doc.sentences[this.index];
    const w = this.wordFromOffset(this.offset, s.words.length, this.sentenceTimings());
    if ((!this.utter && !this.nativeSpeech) || w > this.wordIndex) this.wordIndex = w;
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

  /** The clip is over: whatever the sentence clock says, the passage's last sentence has been read. */
  private finishPassage() {
    if (!this.doc) return;
    this.index = Math.max(this.index, this.passageAt(this.index).end - 1);
    this.advance();
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
    if (delay === 0) {
      this.persistTimer = null;
      // Pausing can be followed immediately by navigation; start saving before the page unloads.
      if (this.doc) this.opts.onPersist(this.snap);
      return;
    }
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
      seeks: this.seeks,
    };
    for (const l of this.listeners) l(this.snap);
  }
}
