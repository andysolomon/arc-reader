import { spawn } from "node:child_process";
import { MPEGDecoder } from "mpg123-decoder";
import { voicedShare } from "./src/engine/voicing";

/**
 * How much of an MP3 clip is voiced speech (see src/engine/voicing.ts), for the web
 * server, which has no Web Audio decoder. Undefined when the clip cannot be decoded.
 */
export async function mp3VoicedShare(body: Uint8Array): Promise<number | undefined> {
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const { channelData, sampleRate, samplesDecoded } = decoder.decode(body);
    if (!samplesDecoded || !channelData[0]) return undefined;
    return voicedShare(channelData[0].subarray(0, samplesDecoded), sampleRate);
  } catch {
    return undefined;
  } finally {
    decoder.free();
  }
}

const OPUS_CHECK_RATE = 24_000;

/**
 * The same measure for an Opus clip in WebM or Ogg, decoded by ffmpeg. Undefined when
 * ffmpeg is missing or cannot read the clip, which leaves the clip unjudged as before.
 */
export function opusVoicedShare(body: Uint8Array, ffmpeg = "ffmpeg"): Promise<number | undefined> {
  return new Promise((answer) => {
    const child = spawn(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "pipe", "-i", "pipe:0",
      "-ac", "1", "-ar", String(OPUS_CHECK_RATE), "-f", "f32le", "pipe:1",
    ], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on("error", () => { /* ffmpeg stopped reading; its exit says why */ });
    child.on("error", () => answer(undefined));
    child.on("close", (code) => {
      const pcm = Buffer.concat(chunks);
      if (code !== 0 || pcm.length < 4) return answer(undefined);
      const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length - (pcm.length % 4)));
      answer(voicedShare(samples, OPUS_CHECK_RATE));
    });
    child.stdin.end(body);
  });
}
