import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { downloadFile, joinWebmOpus, oggToWebm, opusPacketSamples, readOggOpus, readWebmOpus, writeWebmOpus } from "./webmOpus";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url)));
const base64 = (packets: Uint8Array[]) => packets.map((p) => Buffer.from(p).toString("base64"));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
/** ffmpeg's decoding of a file, as 16-bit samples at 48 kHz. */
const decoded = (bytes: Uint8Array) => spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "pipe:1"], { input: bytes, maxBuffer: 1 << 26 }).stdout as Buffer;

describe("Opus in WebM", () => {
  it("counts the samples in a packet from its first byte", () => {
    expect(opusPacketSamples(Uint8Array.of(0xf8))).toBe(960); // CELT 20 ms, one frame
    expect(opusPacketSamples(Uint8Array.of(0x08))).toBe(960); // SILK 20 ms
    expect(opusPacketSamples(Uint8Array.of(0x19))).toBe(5760); // SILK 60 ms, code 1: two frames
    expect(opusPacketSamples(Uint8Array.of(0xfb, 0x03))).toBe(2880); // CELT 20 ms, code 3 with three frames
    expect(opusPacketSamples(new Uint8Array())).toBe(0);
  });

  it("moves an Ogg file's Opus packets into WebM unchanged", () => {
    const ogg = fixture("voiced.opus");
    const stream = readOggOpus(ogg)!;
    expect(stream).toMatchObject({ channels: 1, preSkip: 312 });
    const webm = oggToWebm(ogg)!;
    expect(Buffer.from(webm.subarray(0, 4)).toString("hex")).toBe("1a45dfa3");
    const back = readWebmOpus(webm)!;
    expect(base64(back.packets)).toEqual(base64(stream.packets));
    expect(back).toMatchObject({ channels: 1, preSkip: 312, samples: stream.samples });
    expect(base64([back.head])).toEqual(base64([stream.head]));
  });

  it("gives null for anything that is not Ogg Opus or WebM Opus", () => {
    expect(readOggOpus(new TextEncoder().encode("audio:first"))).toBeNull();
    expect(oggToWebm(fixture("voiced.mp3"))).toBeNull();
    expect(readWebmOpus(fixture("voiced.mp3"))).toBeNull();
  });

  it.skipIf(!hasFfmpeg)("decodes to exactly the samples of the Ogg file it came from", () => {
    for (const name of ["voiced.opus", "breathy.opus"]) {
      const ogg = fixture(name);
      const fromOgg = decoded(ogg);
      expect(fromOgg.length).toBeGreaterThan(0);
      expect(decoded(oggToWebm(ogg)!).equals(fromOgg)).toBe(true);
    }
  });

  it("joins clips into one file holding every packet in order", () => {
    const a = readOggOpus(fixture("voiced.opus"))!;
    const b = readOggOpus(fixture("breathy.opus"))!;
    const joined = readWebmOpus(joinWebmOpus([writeWebmOpus(a), writeWebmOpus(b)])!)!;
    expect(base64(joined.packets)).toEqual(base64([...a.packets, ...b.packets]));
    expect(joined.samples).toBe(a.samples + b.preSkip + b.samples);
  });

  it("downloads MP3 clips end to end, WebM clips joined, and refuses a mix of both", async () => {
    const mp3 = new Blob([fixture("voiced.mp3")], { type: "audio/mpeg" });
    const webm = new Blob([oggToWebm(fixture("voiced.opus"))! as Uint8Array<ArrayBuffer>], { type: "audio/webm" });
    const plain = await downloadFile([mp3, mp3]);
    expect(plain).toMatchObject({ extension: "mp3" });
    expect(plain!.blob.size).toBe(mp3.size * 2);
    const joined = await downloadFile([webm, webm]);
    expect(joined).toMatchObject({ extension: "webm" });
    expect(readWebmOpus(new Uint8Array(await joined!.blob.arrayBuffer()))!.packets).toHaveLength(readWebmOpus(new Uint8Array(await webm.arrayBuffer()))!.packets.length * 2);
    expect(await downloadFile([mp3, webm])).toBeNull();
  });
});
