import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", async (original) => ({ ...(await original<typeof import("./storage")>()), deviceStorage: async () => ({ allowed: 10 * 1024 ** 3 }) }));

import { PRESET_VOICES } from "../data/voices";
import { cacheKey } from "../engine/providers";
import { audioCache, type DocRecord } from "./db";
import { audiobookChapters, audiobookVoices, makeAudiobook } from "./audiobook";
import { aacConfig, audioSpecificConfig, muxM4b } from "./mp4";
import { id3Chapters, mp3Audio } from "./mp3";

/** MPEG-2 Layer III, 48 kbit/s, 24 kHz, mono: 144-byte frames of 576 samples. */
const frame = () => { const f = new Uint8Array(144); f.set([0xff, 0xf3, 0x64, 0xc0]); return f; };
const join = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const id3v2 = join(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5]), new Uint8Array(5));
const id3v1 = join(new TextEncoder().encode("TAG"), new Uint8Array(125));
const info = () => { const f = frame(); f.set(new TextEncoder().encode("Info"), 4 + 9); return f; };

/** Top-level boxes, and the type path of every box inside moov. */
function boxes(bytes: Uint8Array, start = 0, end = bytes.length, path = ""): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const out: string[] = [];
  for (let at = start; at < end;) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    let header = 8;
    if (size === 1) { size = Number(view.getBigUint64(at + 8)); header = 16; }
    out.push(path + type);
    if (["moov", "trak", "mdia", "minf", "stbl", "udta"].includes(type)) out.push(...boxes(bytes, at + header, at + size, `${path}${type}/`));
    at += size;
  }
  return out;
}

describe("MP3 clips", () => {
  it("finds the audio frames past tags and the Info header", () => {
    const clip = join(id3v2, info(), frame(), frame(), frame(), id3v1);
    expect(mp3Audio(clip)).toEqual({ start: id3v2.length + 144, end: id3v2.length + 144 * 4, samples: 3 * 576, sampleRate: 24000 });
    expect(mp3Audio(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
  });

  it("writes an ID3v2.4 chapter list", () => {
    const tag = id3Chapters({ title: "Book", author: "Ann" }, [{ title: "One", start: 0, end: 1000 }, { title: "Two", start: 1000, end: 2500 }]);
    const text = new TextDecoder("latin1").decode(tag);
    expect(text.startsWith("ID3\u0004")).toBe(true);
    for (const id of ["TIT2", "TPE1", "CTOC", "CHAP", "ch1", "ch2"]) expect(text).toContain(id);
    const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
    expect(size).toBe(tag.length - 10);
  });
});

describe("M4B", () => {
  it("lays out audio, a chapter track and audiobook tags", async () => {
    const file = muxM4b({ sampleRate: 24000, channels: 1, config: aacConfig(24000, 1), data: new Blob([new Uint8Array(30)]), sizes: [10, 10, 10], bitrate: 48000 },
      [{ title: "One", start: 0 }, { title: "Two", start: 2048 }], { title: "Book" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tree = boxes(bytes);
    expect(tree.filter((b) => !b.includes("/"))).toEqual(["ftyp", "mdat", "moov"]);
    for (const b of ["moov/mvhd", "moov/trak/tref", "moov/trak/mdia/minf/stbl/stsz", "moov/trak/mdia/minf/stbl/stco", "moov/udta/meta", "moov/udta/chpl"]) expect(tree).toContain(b);
    expect(tree.filter((b) => b === "moov/trak")).toHaveLength(2);
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("M4B ");
    expect(aacConfig(24000, 1)).toEqual(new Uint8Array([0x13, 0x08]));
  });

  it("finds the AAC config inside the ES descriptor Safari's encoder reports", () => {
    // What WebKit's AudioEncoder gave for 24 kHz mono, and what Chrome gives for 44.1 kHz.
    const safari = new Uint8Array([0x03, 0x80, 0x80, 0x80, 0x22, 0x00, 0x00, 0x00, 0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14, 0x00, 0x18, 0x00, 0x00, 0x00, 0xbb, 0x80, 0x00, 0x00, 0xbb, 0x80, 0x05, 0x80, 0x80, 0x80, 0x02, 0x13, 0x08, 0x06, 0x80, 0x80, 0x80, 0x01, 0x02]);
    expect(audioSpecificConfig(safari)).toEqual(new Uint8Array([0x13, 0x08]));
    expect(audioSpecificConfig(new Uint8Array([0x12, 0x08]))).toEqual(new Uint8Array([0x12, 0x08]));
  });
});

const [bella, jasper] = PRESET_VOICES;
const doc = (id: string, text: string, chapter: number): DocRecord => ({ id, title: `Chapter ${chapter}`, text, source: "paste", domain: "Text", voice: null, chars: text.length, createdAt: 1, updatedAt: 1, book: { id: "b", title: "Book", chapter, chapters: 2 } });
const key = (text: string, voice = bella) => cacheKey({ text, voice: voice.id, engine: voice.engine, openaiModel: "gpt-4o-mini-tts" });
const prefix = (voice = bella) => key("x", voice).replace(/[0-9a-f]{8}$/, "");
const names = (p: string) => p.includes(jasper.id) ? "Jasper" : "Bella";
const one = doc("a", "One two. Three four.\n\nFive six.", 1);
const two = doc("b", "Seven eight.", 2);

describe("audiobooks", () => {
  beforeEach(() => audioCache.clear());

  it("counts the documents each voice reads start to finish, including from sentence clips", () => {
    const keys = new Set([key("One two."), key("Three four."), key("Five six."), key("Seven eight."), key("Seven eight.", jasper)]);
    expect(audiobookVoices([one, two], keys, names)).toEqual([
      { prefix: prefix(), name: "Bella", complete: 2, total: 2 },
      { prefix: prefix(jasper), name: "Jasper", complete: 1, total: 2 },
    ]);
  });

  it("joins a voice's clips into chapters, leaving out documents with a passage missing", async () => {
    const mp3 = (n: number) => new Blob([join(...Array.from({ length: n }, frame))], { type: "audio/mpeg" });
    for (const [text, n] of [["One two. Three four.", 2], ["Five six.", 1], ["Seven eight.", 3]] as const) {
      await audioCache.put({ key: key(text, jasper), blob: mp3(n), mime: "audio/mpeg", duration: n * 0.024, createdAt: 1 });
    }
    await audioCache.remove([key("Five six.", jasper)]);
    const { chapters, missing } = await audiobookChapters([one, two], prefix(jasper));
    expect(chapters.map((c) => [c.title, c.clips.length])).toEqual([["2. Chapter 2", 1]]);
    expect(missing.map((d) => d.id)).toEqual(["a"]);

    // Node has no AAC encoder, so this is the MP3 the browsers without one get.
    const book = await makeAudiobook(chapters, { tags: { title: "Book" } });
    expect(book.extension).toBe("mp3");
    const bytes = new Uint8Array(await book.file.arrayBuffer());
    expect(mp3Audio(bytes)?.samples).toBe(3 * 576);
  });
});
