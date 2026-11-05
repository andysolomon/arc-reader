import { describe, it, expect } from "vitest";
import { analyzePcm, encodeWav, joinPcm, proportionalStarts } from "./audio";

const RATE = 16_000;
/** Tone and silence segments in seconds → mono PCM. */
function pcm(segments: { on: boolean; s: number; amp?: number }[]): Float32Array {
  const total = segments.reduce((a, x) => a + x.s, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let at = 0;
  for (const seg of segments) {
    const n = Math.round(seg.s * RATE);
    if (seg.on) for (let i = 0; i < n; i++) out[at + i] = (seg.amp ?? 0.5) * Math.sin((2 * Math.PI * 220 * i) / RATE);
    at += n;
  }
  return out;
}

describe("analyzePcm", () => {
  it("finds sentence starts at the pauses nearest the word-count prediction", () => {
    // lead 0.2 | s1 1.0 | pause 0.4 | s2 1.5 | breath 0.08 | 0.5 | pause 0.3 | s3 0.8 | tail 0.5
    const samples = pcm([
      { on: false, s: 0.2 }, { on: true, s: 1.0 }, { on: false, s: 0.4 }, { on: true, s: 1.5 }, { on: false, s: 0.08 },
      { on: true, s: 0.5 }, { on: false, s: 0.3 }, { on: true, s: 0.8 }, { on: false, s: 0.5 },
    ]);
    const a = analyzePcm(samples, RATE, [4, 8, 3]);
    expect(a.duration).toBeCloseTo(5.28, 2);
    expect(a.lead).toBeCloseTo(0.2, 1);
    expect(a.tail).toBeCloseTo(0.5, 1);
    expect(a.starts).toHaveLength(3);
    expect(a.starts[0]).toBe(0);
    // Second sentence begins at 1.6 s, third at 3.98 s; the highlight leads by up to 80 ms.
    expect(a.starts[1]).toBeGreaterThan(1.45);
    expect(a.starts[1]).toBeLessThanOrEqual(1.6);
    expect(a.starts[2]).toBeGreaterThan(3.85);
    expect(a.starts[2]).toBeLessThanOrEqual(3.98);
    expect(a.loudness).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 0);
  });

  it("falls back to the word-count position when no pause is near it", () => {
    const samples = pcm([{ on: true, s: 4 }]);
    const a = analyzePcm(samples, RATE, [5, 5]);
    expect(a.starts[1]).toBeCloseTo(2, 1);
    expect(a.lead).toBe(0);
    expect(a.tail).toBeCloseTo(0, 2);
  });

  it("treats a silent clip as word-share estimates", () => {
    const a = analyzePcm(new Float32Array(RATE), RATE, [1, 3]);
    expect(a.starts).toEqual(proportionalStarts(1, [1, 3]));
    expect(a.loudness).toBeUndefined();
  });

  it("shares a clip by word count", () => {
    expect(proportionalStarts(10, [1, 1, 2])).toEqual([0, 2.5, 5]);
    expect(proportionalStarts(10, [1, 1], 1, 1)).toEqual([0, 5]);
  });
});

describe("joinPcm", () => {
  it("cuts each join back to a natural pause and starts every later sentence a hair before its first word", () => {
    const clip = () => pcm([{ on: false, s: 0.3 }, { on: true, s: 1.0 }, { on: false, s: 0.6 }]);
    const j = joinPcm([clip(), clip()], RATE);
    // First: whole lead, voice, 0.25 s of tail. Second: 0.05 s of lead, voice, whole tail.
    expect(j.starts[0]).toBe(0);
    expect(j.starts[1]).toBeCloseTo(1.55, 1);
    expect(j.trims[0]).toBe(0);
    expect(j.trims[1]).toBeCloseTo(0.25, 1);
    expect(j.samples.length / RATE).toBeCloseTo(3.2, 1);
  });
});

describe("encodeWav", () => {
  it("writes a mono 16-bit PCM WAV", async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 0.5]), RATE);
    expect(blob.type).toBe("audio/wav");
    const view = new DataView(await blob.arrayBuffer());
    expect(view.byteLength).toBe(44 + 8);
    expect(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(RATE);
    expect([1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 16383]);
  });
});
