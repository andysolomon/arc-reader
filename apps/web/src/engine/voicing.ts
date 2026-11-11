/**
 * OmniVoice occasionally renders a passage as breathy, pitchless noise instead of
 * speech: about one ordinary passage in 600, and one in six that are a single word
 * or two ("12", "Share"). Speech is mostly voiced, so a clip whose sound is nearly
 * all unvoiced is a failed render. VoiceStudio picks a fresh random seed for every
 * request, so asking again almost always gives a clean take.
 *
 * Measured on 2,863 stored clips across five voices: clean takes of a sentence or
 * more put at least 0.33 of their energy in voiced frames; the failed paragraph
 * scored 0.10 and failed single words at most 0.13. A breathy one- or two-word take
 * can land near the line, and asking again for one costs little.
 */
export const GARBLED_BELOW = 0.2;
/** Fresh takes requested after a garbled one, before keeping the best of them. */
export const GARBLED_RETRIES = 2;

/** Analysis rate: enough for pitch up to 400 Hz, and cheap enough for the main thread. */
const RATE = 8000;
const FRAME = 240; // 30 ms
const HOP = 160; // 20 ms
const MIN_LAG = Math.floor(RATE / 400);
const MAX_LAG = Math.ceil(RATE / 60);
/** Normalized correlation at the pitch period above this marks a voiced frame. */
const PERIODIC = 0.75;
/** Frames quieter than this share of the loudest frame's power are silence. */
const SILENT = 1e-3;

function downsample(samples: Float32Array, sampleRate: number): Float32Array {
  const factor = Math.max(1, Math.round(sampleRate / RATE));
  if (factor === 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}

/**
 * Share of a clip's audible energy that sits in voiced (periodic) frames, from 0 to 1.
 * Undefined when the clip is too short or silent to judge.
 */
export function voicedShare(samples: Float32Array, sampleRate: number): number | undefined {
  const rate = sampleRate / Math.max(1, Math.round(sampleRate / RATE));
  const x = downsample(samples, sampleRate);
  const minLag = Math.max(1, Math.round(MIN_LAG * rate / RATE));
  const maxLag = Math.round(MAX_LAG * rate / RATE);
  const frame = Math.round(FRAME * rate / RATE);
  const hop = Math.round(HOP * rate / RATE);
  const powers: number[] = [];
  for (let at = 0; at + frame + maxLag <= x.length; at += hop) {
    let sum = 0;
    for (let j = 0; j < frame; j++) sum += x[at + j] * x[at + j];
    powers.push(sum / frame);
  }
  const peak = powers.reduce((a, b) => Math.max(a, b), 0);
  if (!(peak > 0)) return undefined;
  let audible = 0, voiced = 0;
  powers.forEach((power, k) => {
    if (power < peak * SILENT) return;
    audible += power;
    const at = k * hop;
    const energy = power * frame;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let cross = 0, shifted = 0;
      for (let j = 0; j < frame; j++) {
        const y = x[at + j + lag];
        cross += x[at + j] * y;
        shifted += y * y;
      }
      const r = cross / Math.sqrt(energy * shifted + 1e-12);
      if (r > best) best = r;
    }
    if (best > PERIODIC) voiced += power;
  });
  return audible > 0 ? voiced / audible : undefined;
}

/** True when a decoded clip is almost entirely unvoiced noise rather than speech. */
export function isGarbled(samples: Float32Array, sampleRate: number): boolean {
  const share = voicedShare(samples, sampleRate);
  return share !== undefined && share < GARBLED_BELOW;
}
