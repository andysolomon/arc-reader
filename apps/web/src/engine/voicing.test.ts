import { describe, expect, it } from "vitest";
import { GARBLED_BELOW, isGarbled, voicedShare } from "./voicing";

const RATE = 24000;

/** Syllable-like bursts of a 140 Hz voice with harmonics, separated by short pauses. */
function voice(seconds: number, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const syllable = Math.sin(Math.PI * ((t * 4) % 1)) ** 2;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
    out[i] = 0.2 * syllable * v;
  }
  return out;
}

/** Breathy noise with the same syllable envelope, like a failed render. */
function noise(seconds: number, rate = RATE): Float32Array {
  let seed = 1;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.2 * Math.sin(Math.PI * (((i / rate) * 4) % 1)) ** 2 * random();
  return out;
}

describe("voicedShare", () => {
  it("scores voiced speech high and breathy noise low", () => {
    expect(voicedShare(voice(3), RATE)!).toBeGreaterThan(0.8);
    expect(voicedShare(noise(3), RATE)!).toBeLessThan(0.05);
  });

  it("works at the browser's decode rates", () => {
    for (const rate of [44100, 48000, 16000, 8000]) {
      expect(voicedShare(voice(2, rate), rate)!).toBeGreaterThan(0.8);
      expect(voicedShare(noise(2, rate), rate)!).toBeLessThan(0.05);
    }
  });

  it("leaves silence and empty clips unjudged", () => {
    expect(voicedShare(new Float32Array(RATE), RATE)).toBeUndefined();
    expect(voicedShare(new Float32Array(0), RATE)).toBeUndefined();
    expect(isGarbled(new Float32Array(RATE), RATE)).toBe(false);
  });

  it("flags a clip whose middle sentence turned to noise only when noise dominates", () => {
    const mixed = (noiseSeconds: number) => {
      const a = voice(4), b = noise(noiseSeconds);
      const out = new Float32Array(a.length + b.length);
      out.set(a); out.set(b, a.length);
      return out;
    };
    expect(isGarbled(mixed(2), RATE)).toBe(false);
    expect(isGarbled(noise(6), RATE)).toBe(true);
    expect(GARBLED_BELOW).toBeGreaterThan(0.1);
  });
});
