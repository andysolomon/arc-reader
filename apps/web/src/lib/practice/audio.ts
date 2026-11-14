import { analyzePcm, decodeMono, encodeWav } from "../../engine/audio";
import type { AudioInput } from "./judge";

/** Plenty for speech, and a 30-second reading stays under a megabyte. */
export const JUDGE_SAMPLE_RATE = 16_000;

/** Linear resampling to `rate`; speech for a judge doesn't need a better filter. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(length);
  const step = from / to;
  for (let i = 0; i < length; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const a = samples[Math.min(j, samples.length - 1)];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    out[i] = a + (b - a) * (x - j);
  }
  return out;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface PreparedTake {
  /** 16 kHz mono WAV, for the transcript. */
  wav: Blob;
  /** The same WAV as base64, for the judge. */
  audio: AudioInput;
  /** The take's length, in seconds. */
  duration: number;
  /** Without the silence before and after the reading. */
  speech: number;
}

/** The recorder's webm/m4a as a 16 kHz mono WAV for the judge, with its length and speaking time. */
export async function prepareTake(file: Blob): Promise<PreparedTake> {
  const pcm = await decodeMono(file);
  if (!pcm) throw new Error("This browser couldn't read the recording. Please try again.");
  const { duration, lead, tail } = analyzePcm(pcm.samples, pcm.sampleRate, [1]);
  const wav = encodeWav(resample(pcm.samples, pcm.sampleRate, JUDGE_SAMPLE_RATE), JUDGE_SAMPLE_RATE);
  return { wav, audio: { data: await blobToBase64(wav), format: "wav" }, duration, speech: Math.max(0, duration - lead - tail) };
}
