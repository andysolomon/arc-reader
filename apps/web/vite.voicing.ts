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
