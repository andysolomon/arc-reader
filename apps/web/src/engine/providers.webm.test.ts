import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowser, replies, serve, type Sent } from "./fakeSpeech";
import { cacheKey, openaiSpeechSynthesize, synthesize } from "./providers";
import { audioCache } from "../lib/db";
import { readOggOpus, readWebmOpus } from "../lib/webmOpus";

// A device whose audio element plays Opus in WebM, as Chrome and Firefox do.
vi.stubGlobal("Audio", class { canPlayType = (type: string) => /webm/.test(type) ? "probably" : ""; });
const browser = installBrowser();
let server = serve(replies());
beforeEach(async () => { browser.clearStorage(); await audioCache.clear(); server = serve(replies()); });

const voicedOgg = readFileSync(new URL("../../tests/fixtures/voiced.opus", import.meta.url));
const formats = (sent: Sent[]) => sent.map((s) => (s.body as { response_format: string }).response_format);
const packets = (stream: ReturnType<typeof readOggOpus>) => stream!.packets.map((p) => Buffer.from(p).toString("base64"));
const mp3 = () => new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" }), { headers: { "content-type": "audio/mpeg" } });

describe("a device that plays WebM", () => {
  it("asks VoiceStudio for Opus and saves the same packets as WebM", async () => {
    const req = { text: "Hello there.", voice: "expr-voice-2-f", engine: "kittentts" };
    server = serve(replies(new Response(voicedOgg, { headers: { "content-type": "audio/ogg" } })));
    const c = await synthesize(req);
    expect(formats(server.generated())).toEqual(["opus"]);
    expect(c.mime).toBe("audio/webm");
    const kept = await audioCache.get(cacheKey(req));
    expect(kept?.mime).toBe("audio/webm");
    expect(packets(readWebmOpus(new Uint8Array(await kept!.blob.arrayBuffer())))).toEqual(packets(readOggOpus(voicedOgg)));
  });

  it("asks again for MP3 when the Opus reply is not an Ogg file it can read", async () => {
    server = serve(replies(new Response("not ogg", { headers: { "content-type": "audio/ogg" } }), mp3()));
    const c = await openaiSpeechSynthesize({ text: "Hello there.", voice: "expr-voice-2-f", engine: "kittentts" });
    expect(formats(server.generated())).toEqual(["opus", "mp3"]);
    expect(c.mime).toBe("audio/mpeg");
  });

  it("keeps OpenAI on MP3", async () => {
    server = serve(replies(mp3()));
    await openaiSpeechSynthesize({ text: "Hello there.", voice: "nova", engine: "openai", openaiModel: "tts-1" });
    expect(formats(server.generated())).toEqual(["mp3"]);
  });
});
