/** Measure an audio blob's duration by decoding it. Falls back to the estimate on any failure. */
let ctx: AudioContext | null = null;

export async function measureDuration(blob: Blob, fallback: number): Promise<number> {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return fallback;
    ctx ??= new AC();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buf.duration > 0 && Number.isFinite(buf.duration) ? buf.duration : fallback;
  } catch {
    return fallback;
  }
}
