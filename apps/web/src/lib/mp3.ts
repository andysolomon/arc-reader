/**
 * MP3 clips joined into one file with an ID3 chapter list (CHAP and CTOC frames), for browsers
 * that can't encode AAC. The clips' frames are copied as they are: no re-encoding, no quality lost.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface Frame { length: number; samples: number; sampleRate: number; sideInfo: number }

/** The Layer III frame whose header starts at `at`, or null when there is none. */
function frameAt(bytes: Uint8Array, at: number): Frame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1] >> 3) & 3;
  const layer = (bytes[at + 1] >> 1) & 3;
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
  const sampleRate = RATES[version][rateIndex];
  const padding = (bytes[at + 2] >> 1) & 1;
  const mono = bytes[at + 3] >> 6 === 3;
  return {
    length: Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + padding,
    samples: v1 ? 1152 : 576,
    sampleRate,
    sideInfo: v1 ? (mono ? 17 : 32) : (mono ? 9 : 17),
  };
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

export interface Mp3Audio {
  /** First byte of the first audio frame */
  start: number;
  /** End of the last whole frame */
  end: number;
  samples: number;
  sampleRate: number;
}

/** Where a clip's audio frames are, past its tags and its Xing or Info header. Null when it isn't MP3. */
export function mp3Audio(bytes: Uint8Array): Mp3Audio | null {
  let at = 0;
  if (ascii(bytes, 0, "ID3") && bytes.length >= 10) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    at = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  // Find the first frame that another follows, so stray sync bytes aren't taken for one.
  let first: Frame | null = null;
  for (; at + 4 <= bytes.length; at++) {
    first = frameAt(bytes, at);
    if (first && (at + first.length >= bytes.length || frameAt(bytes, at + first.length))) break;
    first = null;
  }
  if (!first) return null;
  const header = at + 4 + first.sideInfo;
  if (ascii(bytes, header, "Xing") || ascii(bytes, header, "Info") || ascii(bytes, at + 36, "VBRI")) at += first.length;
  const start = at;
  let samples = 0;
  let sampleRate = first.sampleRate;
  for (let frame = frameAt(bytes, at); frame && at + frame.length <= bytes.length; frame = frameAt(bytes, at)) {
    samples += frame.samples;
    sampleRate = frame.sampleRate;
    at += frame.length;
  }
  return at > start ? { start, end: at, samples, sampleRate } : null;
}

const encoder = new TextEncoder();
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function frame(id: string, body: Uint8Array | number[]): number[] {
  const data = [...body];
  return [...encoder.encode(id), ...syncsafe(data.length), 0, 0, ...data];
}
/** A UTF-8 text frame */
const text = (id: string, value: string) => frame(id, [3, ...encoder.encode(value)]);
const latin = (value: string) => [...value].map((c) => c.charCodeAt(0) & 0xff);

export interface Mp3Chapter { title: string; /** milliseconds */ start: number; end: number }

/** An ID3v2.4 tag naming the book and listing its chapters. CTOC counts chapters in one byte. */
export function id3Chapters(tags: { title: string; author?: string; album?: string }, chapters: Mp3Chapter[]): Uint8Array {
  const listed = chapters.slice(0, 255);
  const ids = listed.map((_, i) => `ch${i + 1}`);
  const frames = [
    ...text("TIT2", tags.title),
    ...(tags.author ? text("TPE1", tags.author) : []),
    ...text("TALB", tags.album ?? tags.title),
    ...text("TCON", "Audiobook"),
    ...text("TSSE", "ReadAloud"),
    ...frame("CTOC", [...latin("toc"), 0, 0x03, ids.length, ...ids.flatMap((id) => [...latin(id), 0])]),
    ...listed.flatMap((c, i) => frame("CHAP", [...latin(ids[i]), 0, ...u32(Math.round(c.start)), ...u32(Math.round(c.end)), ...u32(0xffffffff), ...u32(0xffffffff), ...text("TIT2", c.title)])),
  ];
  return new Uint8Array([...encoder.encode("ID3"), 4, 0, 0, ...syncsafe(frames.length), ...frames]);
}
