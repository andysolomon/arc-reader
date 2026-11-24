/**
 * Speech is stored as Opus, about 40% smaller than the MP3s it replaces with no
 * audible difference. Speech servers send Opus in an Ogg file, but an iPhone could
 * not seek in one reliably, while Opus in WebM stored, decoded, sought and played
 * to the end. These functions move the same Opus packets from one file to the
 * other, so nothing is encoded again and nothing is lost. They also join WebM clips
 * into one file for downloading a whole reading.
 *
 * Only what this app needs is supported: one Opus track, frames without lacing,
 * and elements of known size.
 */

/** Opus timestamps count samples at 48 kHz whatever the input rate was. */
const OPUS_RATE = 48_000;
/** Matroska's recommended decoder warm-up after a seek. */
const SEEK_PRE_ROLL_NS = 80_000_000;
/** A new cluster every few seconds; block times inside one must stay under 32.7 s. */
const CLUSTER_MS = 5_000;

export const WEBM_OPUS = 'audio/webm; codecs="opus"';

export interface OpusStream {
  /** The OpusHead packet, which WebM keeps as the track's CodecPrivate. */
  head: Uint8Array;
  packets: Uint8Array[];
  channels: number;
  /** Samples the decoder discards from the start. */
  preSkip: number;
  /** Samples heard, at 48 kHz, after the pre-skip and any end trimming. */
  samples: number;
}

/** Samples in one Opus packet at 48 kHz, from its table-of-contents byte (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length) return 0;
  const config = packet[0] >> 3;
  const frame = config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1]
      : [120, 240, 480, 960][config & 3];
  const code = packet[0] & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
  return frame * frames;
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

function parseHead(head: Uint8Array): { channels: number; preSkip: number } | null {
  if (head.length < 19 || ascii(head, 0, 8) !== "OpusHead") return null;
  return { channels: head[9], preSkip: head[10] | (head[11] << 8) };
}

/** The packets of an Ogg Opus file (RFC 7845), or null when it is anything else. */
export function readOggOpus(bytes: Uint8Array): OpusStream | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packets: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  let serial: number | undefined;
  let granule = -1;
  let pos = 0;
  while (pos < bytes.length) {
    if (pos + 27 > bytes.length || view.getUint32(pos) !== 0x4f676753) return null; // "OggS"
    const stream = view.getUint32(pos + 14, true);
    // A chained or multiplexed file holds more than one stream.
    if (serial === undefined) serial = stream;
    else if (stream !== serial) return null;
    const position = Number(view.getBigInt64(pos + 6, true));
    if (position >= 0) granule = position;
    const count = bytes[pos + 26];
    let at = pos + 27 + count;
    if (at > bytes.length) return null;
    for (let i = 0; i < count; i++) {
      const lace = bytes[pos + 27 + i];
      if (at + lace > bytes.length) return null;
      pending.push(bytes.subarray(at, at + lace));
      at += lace;
      if (lace < 255) { packets.push(concat(pending)); pending = []; }
    }
    pos = at;
  }
  if (packets.length < 2 || ascii(packets[1], 0, 8) !== "OpusTags") return null;
  const head = parseHead(packets[0]);
  if (!head) return null;
  const audio = packets.slice(2).filter((p) => p.length);
  if (!audio.length) return null;
  const total = audio.reduce((n, p) => n + opusPacketSamples(p), 0);
  // The last page's granule position marks where the audio ends, trimming the final frame.
  const end = granule >= 0 ? Math.min(granule, total) : total;
  return { head: packets[0], packets: audio, ...head, samples: Math.max(0, end - head.preSkip) };
}

const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, CodecID: 0x86,
  CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, DiscardPadding: 0x75a2,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
} as const;

function idBytes(id: number): Uint8Array {
  const length = id < 0x100 ? 1 : id < 0x10000 ? 2 : id < 0x1000000 ? 3 : 4;
  return uint(id, length);
}

/** Big-endian unsigned integer, in `width` bytes or as few as it needs. */
function uint(value: number, width?: number): Uint8Array {
  let length = width ?? 1;
  if (!width) while (length < 8 && value >= 2 ** (8 * length)) length++;
  const out = new Uint8Array(length);
  for (let i = length - 1, v = value; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  return out;
}

/** A positive signed integer: a leading zero byte keeps a set top bit from reading as negative. */
function positiveInt(value: number): Uint8Array {
  const bytes = uint(value);
  return bytes[0] & 0x80 ? concat([Uint8Array.of(0), bytes]) : bytes;
}

function sizeBytes(size: number): Uint8Array {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length++;
  const out = uint(size, length);
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function float64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

const text = (value: string) => Uint8Array.from(value, (c) => c.charCodeAt(0));

function el(id: number, body: Uint8Array | Uint8Array[]): Uint8Array {
  const payload = Array.isArray(body) ? concat(body) : body;
  return concat([idBytes(id), sizeBytes(payload.length), payload]);
}

/** A WebM file holding the stream's Opus packets unchanged, with cues for seeking. */
export function writeWebmOpus(stream: OpusStream): Uint8Array {
  const header = el(ID.EBML, [
    el(ID.EBMLVersion, uint(1)), el(ID.EBMLReadVersion, uint(1)), el(ID.EBMLMaxIDLength, uint(4)), el(ID.EBMLMaxSizeLength, uint(8)),
    el(ID.DocType, text("webm")), el(ID.DocTypeVersion, uint(4)), el(ID.DocTypeReadVersion, uint(2)),
  ]);
  const info = el(ID.Info, [
    el(ID.TimecodeScale, uint(1_000_000)), el(ID.MuxingApp, text("ReadAloud")), el(ID.WritingApp, text("ReadAloud")),
    el(ID.Duration, float64((stream.samples / OPUS_RATE) * 1000)),
  ]);
  const tracks = el(ID.Tracks, el(ID.TrackEntry, [
    el(ID.TrackNumber, uint(1)), el(ID.TrackUID, uint(1)), el(ID.TrackType, uint(2)), el(ID.CodecID, text("A_OPUS")),
    el(ID.CodecPrivate, stream.head), el(ID.CodecDelay, uint(Math.round((stream.preSkip / OPUS_RATE) * 1e9))),
    el(ID.SeekPreRoll, uint(SEEK_PRE_ROLL_NS)),
    el(ID.Audio, [el(ID.SamplingFrequency, float64(OPUS_RATE)), el(ID.Channels, uint(stream.channels))]),
  ]));

  const clusters: { time: number; bytes: Uint8Array }[] = [];
  let blocks: Uint8Array[] = [];
  let clusterTime = 0;
  let samples = 0;
  const flush = () => {
    if (blocks.length) clusters.push({ time: clusterTime, bytes: el(ID.Cluster, [el(ID.Timecode, uint(clusterTime)), ...blocks]) });
    blocks = [];
  };
  const total = stream.packets.reduce((n, p) => n + opusPacketSamples(p), 0);
  // Samples of the last frame past the end of the speech, which Ogg trims with its final granule position.
  const padding = Math.max(0, total - stream.preSkip - stream.samples);
  stream.packets.forEach((packet, index) => {
    const time = Math.round((samples / OPUS_RATE) * 1000);
    if (!blocks.length || time - clusterTime >= CLUSTER_MS) { flush(); clusterTime = time; }
    const offset = time - clusterTime;
    const last = index === stream.packets.length - 1;
    // Track 1 and the time relative to the cluster. Every Opus packet decodes on its own, so each is a keyframe.
    const head = (flags: number) => Uint8Array.of(0x81, (offset >> 8) & 0xff, offset & 0xff, flags);
    blocks.push(last && padding
      ? el(ID.BlockGroup, [el(ID.Block, [head(0), packet]), el(ID.DiscardPadding, positiveInt(Math.round((padding / OPUS_RATE) * 1e9)))])
      : el(ID.SimpleBlock, [head(0x80), packet]));
    samples += opusPacketSamples(packet);
  });
  flush();

  // Positions are relative to the start of the Segment's data and written in 8 bytes,
  // so the seek head is the same size before and after they are known.
  const seekHead = (positions: number[]) => el(ID.SeekHead, [ID.Info, ID.Tracks, ID.Cues].map((id, i) =>
    el(ID.Seek, [el(ID.SeekID, idBytes(id)), el(ID.SeekPosition, uint(positions[i], 8))])));
  const seekLength = seekHead([0, 0, 0]).length;
  const infoAt = seekLength;
  const tracksAt = infoAt + info.length;
  let at = tracksAt + tracks.length;
  const cuePoints = clusters.map((cluster) => {
    const point = el(ID.CuePoint, [el(ID.CueTime, uint(cluster.time)), el(ID.CueTrackPositions, [el(ID.CueTrack, uint(1)), el(ID.CueClusterPosition, uint(at))])]);
    at += cluster.bytes.length;
    return point;
  });
  const cues = el(ID.Cues, cuePoints);
  return concat([header, el(ID.Segment, [seekHead([infoAt, tracksAt, at]), info, tracks, ...clusters.map((c) => c.bytes), cues])]);
}

export function oggToWebm(bytes: Uint8Array): Uint8Array | null {
  const stream = readOggOpus(bytes);
  return stream ? writeWebmOpus(stream) : null;
}

function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number } | null {
  const first = bytes[pos];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (pos + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) unknown = false;
  }
  // An element of unknown size (a file written as a live stream) is not supported.
  if (!keepMarker && unknown) return null;
  return { value, length };
}

function* children(bytes: Uint8Array, start: number, end: number): Generator<{ id: number; start: number; end: number }> {
  let pos = start;
  while (pos < end) {
    const id = readVint(bytes, pos, true);
    if (!id) throw new Error("bad element id");
    const size = readVint(bytes, pos + id.length, false);
    if (!size) throw new Error("bad element size");
    const body = pos + id.length + size.length;
    if (body + size.value > end) throw new Error("element overruns its parent");
    yield { id: id.value, start: body, end: body + size.value };
    pos = body + size.value;
  }
}

const readUint = (bytes: Uint8Array, start: number, end: number) => {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  return value;
};

export function readWebmOpus(bytes: Uint8Array): OpusStream | null {
  try {
    let head: Uint8Array | undefined;
    let duration: number | undefined;
    let scale = 1_000_000;
    let track = 1;
    const packets: Uint8Array[] = [];
    const block = (start: number, end: number) => {
      const number = readVint(bytes, start, false);
      if (!number || number.value !== track) return;
      const flags = bytes[start + number.length + 2];
      if (flags & 0x06) throw new Error("laced frames are not supported");
      packets.push(bytes.subarray(start + number.length + 3, end));
    };
    for (const top of children(bytes, 0, bytes.length)) {
      if (top.id !== ID.Segment) continue;
      for (const section of children(bytes, top.start, top.end)) {
        if (section.id === ID.Info) {
          for (const e of children(bytes, section.start, section.end)) {
            if (e.id === ID.TimecodeScale) scale = readUint(bytes, e.start, e.end);
            if (e.id === ID.Duration) {
              const view = new DataView(bytes.buffer, bytes.byteOffset + e.start, e.end - e.start);
              duration = e.end - e.start === 8 ? view.getFloat64(0) : view.getFloat32(0);
            }
          }
        } else if (section.id === ID.Tracks) {
          for (const entry of children(bytes, section.start, section.end)) {
            if (entry.id !== ID.TrackEntry) continue;
            let codec = "", number = 0, priv: Uint8Array | undefined;
            for (const e of children(bytes, entry.start, entry.end)) {
              if (e.id === ID.CodecID) codec = ascii(bytes, e.start, e.end - e.start);
              if (e.id === ID.TrackNumber) number = readUint(bytes, e.start, e.end);
              if (e.id === ID.CodecPrivate) priv = bytes.subarray(e.start, e.end);
            }
            if (codec === "A_OPUS" && priv && !head) { head = priv; track = number; }
          }
        } else if (section.id === ID.Cluster) {
          for (const e of children(bytes, section.start, section.end)) {
            if (e.id === ID.SimpleBlock) block(e.start, e.end);
            else if (e.id === ID.BlockGroup) for (const g of children(bytes, e.start, e.end)) if (g.id === ID.Block) block(g.start, g.end);
          }
        }
      }
    }
    const parsed = head && parseHead(head);
    if (!head || !parsed || !packets.length) return null;
    const total = packets.reduce((n, p) => n + opusPacketSamples(p), 0) - parsed.preSkip;
    const heard = duration !== undefined ? Math.round((duration * scale / 1e9) * OPUS_RATE) : total;
    return { head, packets, ...parsed, samples: Math.max(0, Math.min(heard, total)) };
  } catch {
    return null;
  }
}

/**
 * WebM Opus clips joined into one file, packets unchanged. Each later clip's few
 * milliseconds of encoder warm-up stay in, where a fresh decoder would drop them.
 */
export function joinWebmOpus(clips: Uint8Array[]): Uint8Array | null {
  const streams = clips.map(readWebmOpus);
  if (!streams.length || streams.some((s) => !s || s.channels !== streams[0]!.channels)) return null;
  const [first, ...rest] = streams as OpusStream[];
  return writeWebmOpus({
    ...first,
    packets: streams.flatMap((s) => s!.packets),
    samples: first.samples + rest.reduce((n, s) => n + s.samples + s.preSkip, 0),
  });
}

/** Whether this device plays Opus in WebM. False where there is no audio element, as on the server. */
let playsWebm: boolean | undefined;
export function canPlayWebmOpus(): boolean {
  if (playsWebm === undefined) {
    try {
      playsWebm = typeof Audio !== "undefined" && new Audio().canPlayType(WEBM_OPUS) !== "";
    } catch {
      playsWebm = false;
    }
  }
  return playsWebm;
}

export const isOggOpus = (type: string, bytes: Uint8Array) =>
  /ogg|opus/i.test(type) || (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS");

/**
 * One file of a whole reading. MP3 clips play end to end when their bytes are joined,
 * as before; WebM clips are joined packet by packet. A reading that mixes the two
 * cannot be one file without encoding it again, so it gives null.
 */
export async function downloadFile(clips: Blob[]): Promise<{ blob: Blob; extension: "mp3" | "webm" } | null> {
  const webm = clips.filter((clip) => clip.type.includes("webm"));
  if (!webm.length) return { blob: new Blob(clips, { type: clips[0]?.type || "audio/mpeg" }), extension: "mp3" };
  if (webm.length !== clips.length) return null;
  const joined = joinWebmOpus(await Promise.all(clips.map(async (clip) => new Uint8Array(await clip.arrayBuffer()))));
  return joined ? { blob: new Blob([joined as Uint8Array<ArrayBuffer>], { type: "audio/webm" }), extension: "webm" } : null;
}
