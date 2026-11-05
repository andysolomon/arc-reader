let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

async function decode(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const ac = audioContext();
    if (!ac) return null;
    return await ac.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Measure an audio blob's duration by decoding it. Falls back to the estimate on any failure. */
export async function measureDuration(blob: Blob, fallback: number): Promise<number> {
  const buf = await decode(blob);
  return buf && buf.duration > 0 && Number.isFinite(buf.duration) ? buf.duration : fallback;
}

/** What playback needs to know about a clip that holds several sentences. */
export interface ClipAnalysis {
  duration: number;
  /** Where each sentence starts inside the clip, in seconds; `starts[0]` is 0. */
  starts: number[];
  /** Silence before the first and after the last voiced frame, in seconds. */
  lead: number;
  tail: number;
  /** RMS level of the voiced frames in dBFS; undefined when the clip could not be decoded. */
  loudness?: number;
}

/** Sentence starts by word share alone, for when the audio cannot be inspected. */
export function proportionalStarts(duration: number, partWords: number[], lead = 0, tail = 0): number[] {
  const total = partWords.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, duration - lead - tail);
  const starts: number[] = [];
  let acc = 0;
  for (let k = 0; k < partWords.length; k++) {
    starts.push(k === 0 ? 0 : lead + (acc / total) * span);
    acc += partWords[k];
  }
  return starts;
}

const FRAME_SECONDS = 0.01;
/** Pauses shorter than this are commas and breaths, not sentence ends. */
const MIN_GAP_SECONDS = 0.12;
/** Voiced frames sit above this share of the loudest frame. */
const VOICED_SHARE = 0.02;

/**
 * Locate sentence boundaries in decoded mono PCM. TTS output pauses cleanly
 * between sentences, so each boundary is the pause nearest to where the word
 * count predicts it, preferring longer pauses; the prediction is re-anchored
 * after every match so a voice that speeds up or slows down stays aligned.
 */
export function analyzePcm(samples: Float32Array, sampleRate: number, partWords: number[]): ClipAnalysis {
  const duration = samples.length / sampleRate;
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frames = Math.floor(samples.length / frame);
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i++) sum += samples[base + i] * samples[base + i];
    rms[f] = Math.sqrt(sum / frame);
    if (rms[f] > peak) peak = rms[f];
  }
  if (!(peak > 0)) return { duration, starts: proportionalStarts(duration, partWords), lead: 0, tail: 0 };
  const threshold = peak * VOICED_SHARE;
  let first = -1, last = -1, voicedPower = 0, voicedCount = 0;
  for (let f = 0; f < frames; f++) {
    if (rms[f] < threshold) continue;
    if (first < 0) first = f;
    last = f;
    voicedPower += rms[f] * rms[f];
    voicedCount++;
  }
  const lead = first * FRAME_SECONDS;
  const tail = Math.max(0, duration - (last + 1) * FRAME_SECONDS);
  const loudness = 20 * Math.log10(Math.sqrt(voicedPower / Math.max(1, voicedCount)));

  // Pauses between the first and last voiced frames.
  const gaps: { start: number; end: number }[] = [];
  const minFrames = Math.round(MIN_GAP_SECONDS / FRAME_SECONDS);
  for (let f = first, run = 0; f <= last; f++) {
    if (rms[f] < threshold) {
      run++;
      continue;
    }
    if (run >= minFrames) gaps.push({ start: (f - run) * FRAME_SECONDS, end: f * FRAME_SECONDS });
    run = 0;
  }

  const total = partWords.reduce((a, b) => a + b, 0) || 1;
  const starts = [0];
  let anchorTime = lead;
  let anchorWords = 0;
  let gi = 0;
  const speechEnd = duration - tail;
  for (let k = 1; k < partWords.length; k++) {
    const remainingWords = total - anchorWords || 1;
    const perWord = (speechEnd - anchorTime) / remainingWords;
    const expected = anchorTime + partWords[k - 1] * perWord;
    const nextLen = Math.min(partWords[k - 1], partWords[k]) * perWord;
    const tolerance = Math.max(0.5, 0.4 * nextLen);
    let best = -1, bestScore = -Infinity;
    for (let g = gi; g < gaps.length; g++) {
      const mid = (gaps[g].start + gaps[g].end) / 2;
      if (mid < anchorTime + 0.2) continue;
      if (mid > expected + tolerance) break;
      if (mid < expected - tolerance) continue;
      const len = gaps[g].end - gaps[g].start;
      const score = len * (1 - 0.5 * Math.abs(mid - expected) / tolerance);
      if (score > bestScore) { bestScore = score; best = g; }
    }
    let at: number;
    if (best >= 0) {
      const g = gaps[best];
      at = g.end - Math.min(0.08, (g.end - g.start) / 2);
      gi = best + 1;
    } else {
      at = Math.min(Math.max(expected, anchorTime + 0.2), speechEnd);
    }
    starts.push(at);
    anchorTime = at;
    anchorWords += partWords[k - 1];
  }
  return { duration, starts, lead, tail, loudness: Number.isFinite(loudness) ? loudness : undefined };
}

/** Decode a clip and locate its sentences; falls back to word-share estimates when decoding is unavailable. */
export async function analyzeClip(blob: Blob, fallbackDuration: number, partWords: number[]): Promise<ClipAnalysis> {
  const buf = await decode(blob);
  if (!buf || !(buf.duration > 0) || !buf.length) {
    return { duration: fallbackDuration, starts: proportionalStarts(fallbackDuration, partWords), lead: 0, tail: 0 };
  }
  let mono: Float32Array;
  if (buf.numberOfChannels === 1) mono = buf.getChannelData(0);
  else {
    mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buf.numberOfChannels;
    }
  }
  return analyzePcm(mono, buf.sampleRate, partWords);
}
