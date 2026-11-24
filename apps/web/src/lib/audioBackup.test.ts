import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Plenty of room: the browser allows 10 GB, so 5 GB of audio may be kept.
vi.mock("./storage", async (original) => ({ ...(await original<typeof import("./storage")>()), deviceStorage: async () => ({ allowed: 10 * 1024 ** 3 }) }));

import { PRESET_VOICES } from "../data/voices";
import { cacheKey } from "../engine/providers";
import { audioCache, db, docs, type AudioRecord, type DocRecord } from "./db";
import { backupPlan, backupSummary, buildBackup, importBackup, MANIFEST, NOT_A_BACKUP, offloadKeys, openBackup, parseManifest, planImport } from "./audioBackup";
import { readZip, ZipWriter } from "./zip";

const [bella, jasper] = PRESET_VOICES;
const doc = (id: string, text: string, extra: Partial<DocRecord> = {}): DocRecord => ({ id, title: `Doc ${id}`, text, source: "paste", domain: "Text", voice: null, chars: text.length, createdAt: 1, updatedAt: 1, ...extra });
const key = (text: string, voice = bella) => cacheKey({ text, voice: voice.id, engine: voice.engine, openaiModel: "gpt-4o-mini-tts" });
const clip = (k: string, body: string, extra: Partial<AudioRecord> = {}): AudioRecord => ({ key: k, blob: new Blob([body], { type: "audio/mpeg" }), mime: "audio/mpeg", duration: 1.5, createdAt: 5, ...extra });
const names = (prefix: string) => prefix.includes(jasper.id) ? "Jasper" : "Bella";

const one = doc("a", "One two. Three four.\n\nFive six.", { book: { id: "b", title: "Book", chapter: 1, chapters: 2 } });
const two = doc("b", "Seven eight.", { book: { id: "b", title: "Book", chapter: 2, chapters: 2 } });
const other = doc("c", "Five six.");

beforeEach(async () => {
  await audioCache.clear();
  const d = await db();
  await d.clear("docs");
  await d.clear("outbox");
});

describe("audio backups", () => {
  it("lists a document's clips in reading order, in every voice, each shared clip once", () => {
    const keys = [key("Seven eight."), key("Five six.", jasper), key("Five six."), key("One two. Three four."), key("Unrelated."), key("One two.")];
    const plan = backupPlan([one, two], keys, names);
    expect(plan.map((c) => [c.key, c.path])).toEqual([
      [key("One two. Three four."), "audio/Bella/001 Doc a/0001"],
      [key("One two."), "audio/Bella/001 Doc a/0001-1"],
      [key("Five six.", jasper), "audio/Jasper/001 Doc a/0002"],
      [key("Five six."), "audio/Bella/001 Doc a/0002"],
      [key("Seven eight."), "audio/Bella/002 Doc b/0001"],
    ]);
  });

  it("writes the audio to a file, and loads it back onto a device that lost it", async () => {
    const words = [{ start: 0.1234, end: 0.5 }];
    await audioCache.put(clip(key("One two. Three four."), "AAAA", { words, starts: [0, 0.8], lead: 0.05, tail: 0.3, loudness: -20, voiced: 0.9 }));
    await audioCache.put(clip(key("Five six."), "BB"));
    await audioCache.put(clip(key("Unrelated."), "CCC"));
    expect(await backupSummary([one], names)).toEqual({ clips: 2, bytes: 6, voices: [{ prefix: key("x").replace(/[0-9a-f]{8}$/, ""), name: "Bella", clips: 2, bytes: 6 }] });

    const progress: number[] = [];
    const backup = await buildBackup([one], { title: "Doc a", voiceName: names, onProgress: (done) => progress.push(done) });
    expect(backup.keys).toEqual([key("One two. Three four."), key("Five six.")]);
    expect(backup.bytes).toBe(6);
    expect(progress).toEqual([1, 2]);
    expect((await readZip(backup.file)).map((e) => e.name)).toEqual(["README.txt", "audio/Bella/001 Doc a/0001.mp3", "audio/Bella/001 Doc a/0002.mp3", MANIFEST]);

    // Offloaded, and the document deleted too.
    await audioCache.remove(backup.keys);
    expect((await audioCache.keys()).sort()).toEqual([key("Unrelated.")]);

    const opened = await openBackup(backup.file);
    const plan = await planImport(opened);
    expect(plan).toMatchObject({ bytes: 6, present: 0, known: 0 });
    expect(plan.documents.map((d) => d.id)).toEqual(["a"]);
    expect(await importBackup(opened, plan, { documents: true })).toEqual({ clips: 2, bytes: 6, documents: 1, damaged: 0 });

    const back = await audioCache.get(key("One two. Three four."));
    expect(await back!.blob.text()).toBe("AAAA");
    expect(back).toMatchObject({ mime: "audio/mpeg", duration: 1.5, words: [{ start: 0.123, end: 0.5 }], starts: [0, 0.8], lead: 0.05, tail: 0.3, loudness: -20, voiced: 0.9, bytes: 4 });
    expect(back!.createdAt).toBeGreaterThan(5);
    expect((await docs.get("a"))?.text).toBe(one.text);

    // Loading the same file again finds everything already here.
    expect(await planImport(opened)).toMatchObject({ clips: [], bytes: 0, present: 2, documents: [], known: 1 });
  });

  it("skips a clip whose bytes were damaged", async () => {
    await audioCache.put(clip(key("Seven eight."), "GOOD"));
    const backup = await buildBackup([two], { title: "Doc b", voiceName: names });
    const raw = new Uint8Array(await backup.file.arrayBuffer());
    const good = new TextEncoder().encode("GOOD");
    const at = raw.findIndex((_, i) => good.every((byte, j) => raw[i + j] === byte));
    raw[at] = 0x58;
    await audioCache.clear();
    const opened = await openBackup(new Blob([raw]));
    expect(await importBackup(opened, await planImport(opened), { documents: false })).toMatchObject({ clips: 0, damaged: 1 });
    expect(await audioCache.keys()).toEqual([]);
  });

  it("keeps clips another document in the library still reads", () => {
    const keys = [key("One two. Three four."), key("Five six.")];
    expect(offloadKeys(keys, [one], [one, two, other])).toEqual([key("One two. Three four.")]);
    expect(offloadKeys(keys, [one, other], [one, two, other])).toEqual(keys);
  });

  it("refuses files that aren't backups, and drops entries it can't trust", async () => {
    await expect(openBackup(new Blob(["nope"]))).rejects.toThrow(NOT_A_BACKUP);
    const zip = new ZipWriter();
    await zip.add("other.json", new TextEncoder().encode("{}"));
    await expect(openBackup(zip.finish())).rejects.toThrow(NOT_A_BACKUP);
    expect(() => parseManifest({ format: "readaloud-audio", version: 99, clips: [] })).toThrow("newer version");

    const manifest = parseManifest({
      format: "readaloud-audio", version: 1, title: "T",
      documents: [one, { id: "x" }],
      clips: [
        { key: key("One two."), path: "a.mp3", mime: "text/html", duration: 1, bytes: 3, words: [{ start: "x" }] },
        { key: "not a key", path: "b.mp3", duration: 1 },
        { key: key("Five six."), path: "c.mp3", duration: 0 },
      ],
    });
    expect(manifest.documents.map((d) => d.id)).toEqual(["a"]);
    expect(manifest.clips).toEqual([{ key: key("One two."), path: "a.mp3", mime: "audio/mpeg", bytes: 3, duration: 1 }]);
  });
});
