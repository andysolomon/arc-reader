import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { mp3VoicedShare, opusVoicedShare } from "./vite.voicing";
import { oggToWebm } from "./src/lib/webmOpus";
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

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe("opusVoicedShare", () => {
  it.skipIf(!hasFfmpeg)("decodes Opus in WebM with ffmpeg and tells voiced sound from breathy noise", async () => {
    const webm = async (name: string) => oggToWebm(await readFile(new URL(`./tests/fixtures/${name}`, import.meta.url)))!;
    expect(await opusVoicedShare(await webm("voiced.opus"))).toBeGreaterThan(0.8);
    expect(await opusVoicedShare(await webm("breathy.opus"))).toBeLessThan(GARBLED_BELOW);
  });

  it("leaves a clip unjudged when ffmpeg is missing or can't read it", async () => {
    expect(await opusVoicedShare(Buffer.from("audio:first"), "/nonexistent/ffmpeg")).toBeUndefined();
    if (hasFfmpeg) expect(await opusVoicedShare(Buffer.from("audio:first"))).toBeUndefined();
  });
});
