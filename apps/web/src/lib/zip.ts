import { inflateSync } from "fflate";

/**
 * ZIP files built from Blobs without holding their bytes. MP3 is already compressed, so entries
 * are stored as they are, and the archive is a Blob of the original Blobs between small headers:
 * a book of saved audio becomes a file without first being copied into memory. Each entry is read
 * once, for its checksum. Archives past 4 GB or 65,535 entries use ZIP64.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const U32 = 0xffffffff;
const U16 = 0xffff;
/** General purpose flag: names are UTF-8. */
const UTF8 = 0x0800;
const encoder = new TextEncoder();

/** MS-DOS date and time, as ZIP stores them. */
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Bytes {
  readonly buf: Uint8Array<ArrayBuffer>;
  private view: DataView;
  private at = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u16(v: number) { this.view.setUint16(this.at, v, true); this.at += 2; return this; }
  u32(v: number) { this.view.setUint32(this.at, v >>> 0, true); this.at += 4; return this; }
  u64(v: number) { this.view.setBigUint64(this.at, BigInt(v), true); this.at += 8; return this; }
  bytes(v: Uint8Array) { this.buf.set(v, this.at); this.at += v.length; return this; }
}

interface Written { name: Uint8Array; crc: number; size: number; offset: number }

export class ZipWriter {
  private parts: BlobPart[] = [];
  private written: Written[] = [];
  private offset = 0;
  private stamp = dosTime(new Date());

  get size() { return this.offset; }
  get count() { return this.written.length; }

  /** Add one stored entry. A Blob is read once here for its checksum, and kept by reference. */
  async add(path: string, data: Blob | Uint8Array): Promise<void> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    const crc = crc32(bytes);
    const size = bytes.length;
    if (size >= U32) throw new Error(`${path} is too large to store`);
    const name = encoder.encode(path);
    const header = new Bytes(30 + name.length)
      .u32(0x04034b50).u16(20).u16(UTF8).u16(0).u16(this.stamp.time).u16(this.stamp.date)
      .u32(crc).u32(size).u32(size).u16(name.length).u16(0).bytes(name);
    this.parts.push(header.buf, data instanceof Uint8Array ? bytes as Uint8Array<ArrayBuffer> : data);
    this.written.push({ name, crc, size, offset: this.offset });
    this.offset += header.buf.length + size;
  }

  /** The archive. Adding more afterwards is not supported. */
  finish(type = "application/zip"): Blob {
    const start = this.offset;
    let central = 0;
    for (const entry of this.written) {
      const far = entry.offset >= U32;
      const record = new Bytes(46 + entry.name.length + (far ? 12 : 0))
        .u32(0x02014b50).u16(far ? 45 : 20).u16(far ? 45 : 20).u16(UTF8).u16(0).u16(this.stamp.time).u16(this.stamp.date)
        .u32(entry.crc).u32(entry.size).u32(entry.size).u16(entry.name.length).u16(far ? 12 : 0).u16(0).u16(0).u16(0).u32(0)
        .u32(far ? U32 : entry.offset).bytes(entry.name);
      if (far) record.u16(0x0001).u16(8).u64(entry.offset);
      this.parts.push(record.buf);
      central += record.buf.length;
    }
    const count = this.written.length;
    const zip64 = count >= U16 || start >= U32 || central >= U32;
    if (zip64) {
      const end64 = start + central;
      this.parts.push(
        new Bytes(56).u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(count).u64(count).u64(central).u64(start).buf,
        new Bytes(20).u32(0x07064b50).u32(0).u64(end64).u32(1).buf,
      );
    }
    this.parts.push(new Bytes(22).u32(0x06054b50).u16(0).u16(0)
      .u16(zip64 ? U16 : count).u16(zip64 ? U16 : count).u32(zip64 ? U32 : central).u32(zip64 ? U32 : start).u16(0).buf);
    return new Blob(this.parts, { type });
  }
}

export interface ZipEntry {
  name: string;
  /** Where the entry's local header starts */
  offset: number;
  /** Stored size */
  size: number;
  /** Size once inflated */
  length: number;
  /** 0 stored, 8 deflated */
  method: number;
  /** CRC-32 of the inflated contents */
  crc: number;
}

const decoder = new TextDecoder();
const read = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());
const big = (view: DataView, at: number) => Number(view.getBigUint64(at, true));

/** The entries listed in an archive's central directory. Throws when the file is not a ZIP. */
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, blob.size - (22 + U16));
  const tail = await read(blob, tailStart, blob.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("This file isn't a ZIP archive");
  let count = tail.getUint16(end + 10, true);
  let size = tail.getUint32(end + 12, true);
  let start = tail.getUint32(end + 16, true);
  if ((count === U16 || size === U32 || start === U32) && end >= 20 && tail.getUint32(end - 20, true) === 0x07064b50) {
    const at = big(tail, end - 12);
    const record = await read(blob, at, at + 56);
    if (record.getUint32(0, true) !== 0x06064b50) throw new Error("This ZIP archive is damaged");
    count = big(record, 32);
    size = big(record, 40);
    start = big(record, 48);
  }
  if (start + size > blob.size) throw new Error("This ZIP archive is incomplete");
  const dir = await read(blob, start, start + size);
  const entries: ZipEntry[] = [];
  for (let at = 0, n = 0; n < count; n++) {
    if (at + 46 > dir.byteLength || dir.getUint32(at, true) !== 0x02014b50) throw new Error("This ZIP archive is damaged");
    const method = dir.getUint16(at + 10, true);
    const crc = dir.getUint32(at + 16, true);
    let stored = dir.getUint32(at + 20, true);
    let length = dir.getUint32(at + 24, true);
    const nameLength = dir.getUint16(at + 28, true);
    const extraLength = dir.getUint16(at + 30, true);
    const commentLength = dir.getUint16(at + 32, true);
    let offset = dir.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + at + 46, nameLength));
    // ZIP64 sizes and offsets follow in order, each present only when its field above is saturated.
    for (let x = at + 46 + nameLength, xEnd = x + extraLength; x + 4 <= xEnd;) {
      const id = dir.getUint16(x, true), len = dir.getUint16(x + 2, true);
      if (id === 0x0001) {
        let f = x + 4;
        if (length === U32) { length = big(dir, f); f += 8; }
        if (stored === U32) { stored = big(dir, f); f += 8; }
        if (offset === U32) { offset = big(dir, f); }
      }
      x += 4 + len;
    }
    entries.push({ name, offset, size: stored, length, method, crc });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** An entry's contents. Stored entries are a slice of the file; deflated ones are inflated into memory. */
export async function zipEntry(blob: Blob, entry: ZipEntry): Promise<Blob> {
  const header = await read(blob, entry.offset, entry.offset + 30);
  if (header.getUint32(0, true) !== 0x04034b50) throw new Error(`${entry.name} is damaged`);
  const data = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const raw = blob.slice(data, data + entry.size);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return new Blob([inflateSync(new Uint8Array(await raw.arrayBuffer())) as Uint8Array<ArrayBuffer>]);
  throw new Error(`${entry.name} is compressed in a way this app can't read`);
}
