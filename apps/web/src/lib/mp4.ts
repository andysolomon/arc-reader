/**
 * An M4B audiobook: AAC audio with a chapter list, as Apple Books, BookPlayer and most audiobook
 * players read it. Chapters are written twice, as a QuickTime chapter track (Apple's players) and
 * as a Nero `chpl` list (most others). The audio is passed as a Blob and kept by reference, so a
 * long book is never copied into memory to be written out.
 */

export interface AacTrack {
  sampleRate: number;
  channels: number;
  /** The AudioSpecificConfig the encoder reported (see aacConfig) */
  config: Uint8Array;
  /** Every encoded frame, back to back */
  data: Blob;
  /** Each frame's size in bytes, in order */
  sizes: ArrayLike<number>;
  /** Average bits per second */
  bitrate: number;
}

export interface Chapter {
  title: string;
  /** Where it starts, in samples from the start of the book */
  start: number;
}

export interface BookTags {
  title: string;
  author?: string;
  /** The series or collection a volume belongs to */
  album?: string;
}

export const SAMPLES_PER_AAC_FRAME = 1024;

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AudioSpecificConfig for AAC-LC, for an encoder that doesn't report one. */
export function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const index = SAMPLE_RATES.indexOf(sampleRate);
  if (index < 0) throw new Error(`AAC has no sample rate ${sampleRate}`);
  return new Uint8Array([(2 << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3)]);
}

/**
 * The AudioSpecificConfig inside what an encoder reported. Chrome reports the config itself;
 * Safari reports a whole ES_Descriptor (an esds box's contents), with the config nested inside.
 */
export function audioSpecificConfig(description: Uint8Array): Uint8Array {
  if (description[0] !== 0x03) return description;
  /** The body of the first descriptor with this tag between `at` and `end` */
  const find = (tag: number, at: number, end: number): [number, number] | null => {
    while (at < end) {
      const found = description[at++];
      let length = 0;
      for (let k = 0; k < 4 && at < end; k++) {
        const b = description[at++];
        length = (length << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      if (found === tag) return [at, Math.min(end, at + length)];
      at += length;
    }
    return null;
  };
  const es = find(0x03, 0, description.length);
  if (!es) return description;
  const flags = description[es[0] + 2];
  let at = es[0] + 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x20 ? 2 : 0);
  if (flags & 0x40) at += 1 + description[at];
  const config = find(0x04, at, es[1]);
  const specific = config && find(0x05, config[0] + 13, config[1]);
  return specific ? description.slice(specific[0], specific[1]) : description;
}

const encoder = new TextEncoder();
const U32 = 0x1_0000_0000;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Big-endian fields. */
function be(...fields: [bytes: 1 | 2 | 3 | 4 | 8, value: number][]): Uint8Array {
  const out = new Uint8Array(fields.reduce((n, [b]) => n + b, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 8) view.setBigUint64(at, BigInt(value));
    else if (bytes === 4) view.setUint32(at, value >>> 0);
    else if (bytes === 3) { view.setUint16(at, value >>> 8); view.setUint8(at + 2, value & 0xff); }
    else if (bytes === 2) view.setUint16(at, value);
    else view.setUint8(at, value);
    at += bytes;
  }
  return out;
}

const fourcc = (type: string) => type.length === 4 ? new Uint8Array([...type].map((c) => c.charCodeAt(0))) : (() => { throw new Error(`Bad box type ${type}`); })();
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(parts);
  return concat([be([4, body.length + 8]), fourcc(type), body]);
};
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) => box(type, be([1, version], [3, flags]), ...parts);
const zeros = (n: number) => new Uint8Array(n);
const hex = (text: string) => new Uint8Array(text.match(/../g)!.map((b) => parseInt(b, 16)));
const MATRIX = be([4, 0x00010000], [4, 0], [4, 0], [4, 0], [4, 0x00010000], [4, 0], [4, 0], [4, 0], [4, 0x40000000]);
/** "und": no particular language */
const LANGUAGE = 0x55c4;

/** A field that may outgrow 32 bits: version 1 boxes carry 64-bit times. */
const wide = (n: number) => n >= U32;

function mvhd(duration: number, nextTrack: number) {
  const v = wide(duration) ? 1 : 0;
  const t = v ? 8 : 4;
  return full("mvhd", v, 0, be([t, 0], [t, 0], [4, 1000], [t, duration], [4, 0x00010000], [2, 0x0100]), zeros(10), MATRIX, zeros(24), be([4, nextTrack]));
}

function tkhd(id: number, flags: number, duration: number, audio: boolean) {
  const v = wide(duration) ? 1 : 0;
  const t = v ? 8 : 4;
  return full("tkhd", v, flags, be([t, 0], [t, 0], [4, id], [4, 0], [t, duration]), zeros(8), be([2, 0], [2, 0], [2, audio ? 0x0100 : 0], [2, 0]), MATRIX, be([4, 0], [4, 0]));
}

function mdhd(timescale: number, duration: number) {
  const v = wide(duration) ? 1 : 0;
  const t = v ? 8 : 4;
  return full("mdhd", v, 0, be([t, 0], [t, 0], [4, timescale], [t, duration], [2, LANGUAGE], [2, 0]));
}

const hdlr = (handler: string, name: string) => full("hdlr", 0, 0, be([4, 0]), fourcc(handler), zeros(12), encoder.encode(`${name}\0`));
const dinf = () => box("dinf", full("dref", 0, 0, be([4, 1]), full("url ", 0, 1)));

function chunkOffsets(offsets: number[]) {
  return offsets.some(wide)
    ? full("co64", 0, 0, be([4, offsets.length]), ...offsets.map((o) => be([8, o])))
    : full("stco", 0, 0, be([4, offsets.length]), ...offsets.map((o) => be([4, o])));
}

function sizesBox(sizes: ArrayLike<number>) {
  const out = new Uint8Array(sizes.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < sizes.length; i++) view.setUint32(i * 4, sizes[i]);
  return full("stsz", 0, 0, be([4, 0], [4, sizes.length]), out);
}

const descriptor = (tag: number, ...parts: Uint8Array[]) => {
  const body = concat(parts);
  return concat([be([1, tag], [1, 0x80], [1, 0x80], [1, 0x80], [1, body.length]), body]);
};

/** Frames per chunk: each chunk is one offset in the index. */
const CHUNK = 64;

function audioTrak(track: AacTrack, mediaDuration: number, movieDuration: number, firstOffset: number) {
  const frames = track.sizes.length;
  let largest = 0;
  for (let i = 0; i < frames; i++) largest = Math.max(largest, track.sizes[i]);
  const esds = full("esds", 0, 0, descriptor(3,
    be([2, 1], [1, 0]),
    descriptor(4, be([1, 0x40], [1, 0x15], [3, largest], [4, track.bitrate], [4, track.bitrate]), descriptor(5, track.config)),
    descriptor(6, be([1, 2])),
  ));
  const mp4a = box("mp4a", zeros(6), be([2, 1]), zeros(8), be([2, track.channels], [2, 16], [2, 0], [2, 0], [4, (track.sampleRate & 0xffff) * 0x10000]), esds);
  const offsets: number[] = [];
  for (let i = 0, at = firstOffset; i < frames; i++) {
    if (i % CHUNK === 0) offsets.push(at);
    at += track.sizes[i];
  }
  const chunks = offsets.length;
  const last = frames - (chunks - 1) * CHUNK;
  const stsc = last === CHUNK || chunks === 1
    ? full("stsc", 0, 0, be([4, 1], [4, 1], [4, chunks === 1 ? frames : CHUNK], [4, 1]))
    : full("stsc", 0, 0, be([4, 2], [4, 1], [4, CHUNK], [4, 1], [4, chunks], [4, last], [4, 1]));
  const stbl = box("stbl",
    full("stsd", 0, 0, be([4, 1]), mp4a),
    full("stts", 0, 0, be([4, 1], [4, frames], [4, SAMPLES_PER_AAC_FRAME])),
    stsc, sizesBox(track.sizes), chunkOffsets(offsets),
  );
  return box("trak",
    tkhd(1, 3, movieDuration, true),
    // The chapter list is track 2.
    box("tref", box("chap", be([4, 2]))),
    box("mdia", mdhd(track.sampleRate, mediaDuration), hdlr("soun", "SoundHandler"), box("minf", full("smhd", 0, 0, be([2, 0], [2, 0])), dinf(), stbl)),
  );
}

/** A QuickTime text sample: its length, the UTF-8 title, and a note that it is UTF-8. */
const textSample = (title: string) => {
  const text = encoder.encode(title);
  return concat([be([2, text.length]), text, box("encd", be([4, 0x100]))]);
};

// The QuickTime text sample description and header, as Apple's tools write them.
const TEXT_ENTRY = hex("7465787400000000000000010000000100000000000000000000000000000000000000010000000000000000000d667461620001000100");
const TEXT_GMHD = box("gmhd", full("gmin", 0, 0, hex("004080008000800000000000")), box("text", hex("000100000000000000000000000000000001000000000000000000000000000040000000")));

function chapterTrak(samples: Uint8Array[], durations: number[], timescale: number, mediaDuration: number, movieDuration: number, offset: number) {
  const stbl = box("stbl",
    full("stsd", 0, 0, be([4, 1]), concat([be([4, TEXT_ENTRY.length + 4]), TEXT_ENTRY])),
    full("stts", 0, 0, be([4, durations.length]), ...durations.map((d) => be([4, 1], [4, d]))),
    full("stsc", 0, 0, be([4, 1], [4, 1], [4, samples.length], [4, 1])),
    sizesBox(samples.map((s) => s.length)),
    chunkOffsets([offset]),
  );
  return box("trak",
    tkhd(2, 2, movieDuration, false),
    box("mdia", mdhd(timescale, mediaDuration), hdlr("text", "SubtitleHandler"), box("minf", TEXT_GMHD, dinf(), stbl)),
  );
}

const tag = (name: string, value: string) => box(name, box("data", be([4, 1], [4, 0]), encoder.encode(value)));
/** iTunes item names start with ©, which is one byte in the box type. */
const itunes = (name: string) => `©${name}`;

function metadata(tags: BookTags, chapters: Chapter[], timescale: number) {
  const items = [
    tag(itunes("nam"), tags.title),
    ...(tags.author ? [tag(itunes("ART"), tags.author)] : []),
    tag(itunes("alb"), tags.album ?? tags.title),
    tag(itunes("gen"), "Audiobook"),
    tag(itunes("too"), "ReadAloud"),
    // Media kind 2: an audiobook.
    box("stik", box("data", be([4, 21], [4, 0], [1, 2]))),
  ];
  // Nero's list counts chapters in one byte.
  const listed = chapters.slice(0, 255);
  const chpl = box("chpl", be([1, 1], [3, 0], [4, 0], [1, listed.length]), ...listed.map((c) => {
    const title = encoder.encode(c.title).slice(0, 255);
    return concat([be([8, Math.round((c.start / timescale) * 10_000_000)], [1, title.length]), title]);
  }));
  return box("udta",
    full("meta", 0, 0, full("hdlr", 0, 0, be([4, 0]), fourcc("mdir"), fourcc("appl"), zeros(8), zeros(1)), box("ilst", ...items)),
    chpl,
  );
}

/** The whole file: header, the audio and chapter titles, then the index of both. */
export function muxM4b(track: AacTrack, chapters: Chapter[], tags: BookTags): Blob {
  const frames = track.sizes.length;
  if (!frames) throw new Error("There is no audio to write");
  const timescale = track.sampleRate;
  const mediaDuration = frames * SAMPLES_PER_AAC_FRAME;
  const movieDuration = Math.round((mediaDuration / timescale) * 1000);
  const ordered = (chapters.length ? chapters : [{ title: tags.title, start: 0 }])
    .map((c) => ({ ...c, start: Math.max(0, Math.min(mediaDuration - 1, Math.round(c.start))) }))
    .sort((a, b) => a.start - b.start);
  ordered[0] = { ...ordered[0], start: 0 };
  const durations = ordered.map((c, i) => (i + 1 < ordered.length ? ordered[i + 1].start : mediaDuration) - c.start);
  const kept = ordered.filter((_, i) => durations[i] > 0);
  const keptDurations = durations.filter((d) => d > 0);
  const samples = kept.map((c) => textSample(c.title));

  const ftyp = box("ftyp", fourcc("M4B "), be([4, 0x200]), fourcc("M4B "), fourcc("M4A "), fourcc("mp42"), fourcc("isom"));
  const audioBytes = track.data.size;
  const textBytes = samples.reduce((n, s) => n + s.length, 0);
  // A 64-bit size, so a book past 4 GB needs no other layout.
  const mdatHeader = concat([be([4, 1]), fourcc("mdat"), be([8, 16 + audioBytes + textBytes])]);
  const audioStart = ftyp.length + mdatHeader.length;
  const textStart = audioStart + audioBytes;
  const moov = box("moov",
    mvhd(movieDuration, 3),
    audioTrak(track, mediaDuration, movieDuration, audioStart),
    chapterTrak(samples, keptDurations, timescale, mediaDuration, movieDuration, textStart),
    metadata(tags, kept, timescale),
  );
  return new Blob([ftyp, mdatHeader, track.data, ...samples, moov] as BlobPart[], { type: "audio/mp4" });
}
