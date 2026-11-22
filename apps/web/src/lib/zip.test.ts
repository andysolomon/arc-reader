import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { crc32, readZip, zipEntry, ZipWriter } from "./zip";

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(strToU8("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes stored entries another reader opens, and reads them back", async () => {
    const zip = new ZipWriter();
    await zip.add("README.txt", strToU8("hello"));
    await zip.add("audio/Ünïcode voice/0001.mp3", new Blob([new Uint8Array([1, 2, 3, 4])]));
    const file = zip.finish();
    const other = unzipSync(await bytes(file));
    expect(strFromU8(other["README.txt"])).toBe("hello");
    expect([...other["audio/Ünïcode voice/0001.mp3"]]).toEqual([1, 2, 3, 4]);

    const entries = await readZip(file);
    expect(entries.map((e) => e.name)).toEqual(["README.txt", "audio/Ünïcode voice/0001.mp3"]);
    expect([...await bytes(await zipEntry(file, entries[1]))]).toEqual([1, 2, 3, 4]);
    expect(entries[0].crc).toBe(crc32(strToU8("hello")));
  });

  it("reads deflated entries, as an archive re-zipped elsewhere has", async () => {
    const file = new Blob([zipSync({ "a.txt": strToU8("x".repeat(500)) }, { level: 9 })]);
    const [entry] = await readZip(file);
    expect(entry.method).toBe(8);
    expect(await (await zipEntry(file, entry)).text()).toBe("x".repeat(500));
  });

  it("uses ZIP64 past 65,535 entries", async () => {
    const zip = new ZipWriter();
    const one = strToU8("a");
    for (let i = 0; i < 65_600; i++) await zip.add(`${i}`, one);
    const file = zip.finish();
    const entries = await readZip(file);
    expect(entries).toHaveLength(65_600);
    expect(await (await zipEntry(file, entries[65_599])).text()).toBe("a");
  });

  it("refuses a file that isn't a ZIP", async () => {
    await expect(readZip(new Blob(["just some text"]))).rejects.toThrow("isn't a ZIP");
  });
});
