import { decodeMono } from "@readaloud/practice/pcm";
import { voicedShare } from "./voicing";

/** Decoding and analysing clips lives in the practice package, which Cadence shares. */
export * from "@readaloud/practice/pcm";

/** Decode a clip and measure how much of it is voiced speech (see voicing.ts); undefined when it cannot be decoded or judged. */
export async function clipVoicedShare(blob: Blob): Promise<number | undefined> {
  const pcm = await decodeMono(blob);
  return pcm ? voicedShare(pcm.samples, pcm.sampleRate) : undefined;
}
