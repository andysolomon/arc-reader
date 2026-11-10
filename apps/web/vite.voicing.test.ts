import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { mp3VoicedShare } from "./vite.voicing";
import { GARBLED_BELOW } from "./src/engine/voicing";

describe("mp3VoicedShare", () => {
  it("decodes MP3 on the server and tells voiced sound from breathy noise", async () => {
    const voiced = await mp3VoicedShare(await readFile(new URL("./tests/fixtures/voiced.mp3", import.meta.url)));
    const breathy = await mp3VoicedShare(await readFile(new URL("./tests/fixtures/breathy.mp3", import.meta.url)));
    expect(voiced).toBeGreaterThan(0.8);
    expect(breathy).toBeLessThan(GARBLED_BELOW);
  });

  it("leaves bytes that are not MP3 unjudged", async () => {
    expect(await mp3VoicedShare(Buffer.from("audio:first"))).toBeUndefined();
  });
});
