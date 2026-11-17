import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpError } from "./vite.llm";
import { SpeechActivity } from "./vite.speech-activity";
import { PIECE_SECONDS, VideoTranscripts, ffmpegSound, transcribeMiddleware, transcriptParagraphs, wav, type Segment } from "./vite.transcribe";
import type { FxTweet } from "./vite.xpost";

const TARGET = "http://voicestudio.test";
const VIDEO = "https://video.twimg.com/amplify_video/1/vid/avc1/480x270/small.mp4?tag=29";
const tweet = (seconds: number): FxTweet => ({
  text: "A talk",
  media: { videos: [{ url: "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/big.mp4", duration: seconds, type: "video", formats: [
    { url: "https://video.twimg.com/amplify_video/1/pl/list.m3u8", container: "m3u8" },
    { url: "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/big.mp4", container: "mp4", bitrate: 2_176_000 },
    { url: VIDEO, container: "mp4", bitrate: 256_000 },
  ] }] },
});

describe("transcript paragraphs", () => {
  const sentence = (start: number, end: number, text: string): Segment => ({ start, end, text });

  it("starts a paragraph at a pause once a few sentences are in", () => {
    const long = "This sentence is here to fill the paragraph up. ".repeat(9).trim();
    expect(transcriptParagraphs([
      sentence(0, 4, " Short opener. "), sentence(5, 9, long), sentence(9.1, 12, "No pause before this one."), sentence(13, 15, "A pause came first."),
    ])).toEqual([`Short opener. ${long} No pause before this one.`, "A pause came first."]);
  });

  it("breaks a paragraph that runs long, but never inside a sentence", () => {
    const run = Array.from({ length: 12 }, (_, i) => sentence(i * 5, i * 5 + 5, `Sentence number ${i} goes on for a good while without the speaker stopping, as fast talkers do.`));
    const paragraphs = transcriptParagraphs(run);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.join(" ")).toBe(run.map((s) => s.text).join(" "));
    for (const paragraph of paragraphs) expect(paragraph).toMatch(/\.$/);
    expect(transcriptParagraphs([sentence(0, 2, "no full stop yet"), sentence(9, 11, "and it carries on")])).toEqual(["no full stop yet and it carries on"]);
  });
});

describe("video transcripts", () => {
  let directory: string;
  /** Sentences VoiceStudio hears in each piece, by request; a number is an HTTP status to answer with. */
  let pieces: (Segment[] | number)[];
  let sent: { seconds: number; mode: string; key: string | null }[];
  let calls: string[];
  let post: FxTweet | null;
  const upstream: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.fxtwitter.com/status/")) return post ? Response.json({ code: 200, tweet: post }) : Response.json({ code: 404 }, { status: 404 });
    if (url === VIDEO) return new Response("mp4 bytes");
    if (url === `${TARGET}/transcribe`) {
      const form = init!.body as FormData;
      sent.push({ seconds: ((form.get("audio") as File).size - 44) / 32000, mode: String(form.get("mode")), key: new Headers(init!.headers).get("authorization") });
      const answer = pieces.shift();
      if (typeof answer === "number") return Response.json({ detail: "pool saturated" }, { status: answer, headers: answer === 429 ? { "retry-after": "30" } : {} });
      return Response.json({ text: (answer ?? []).map((s) => s.text).join(" "), segments: answer ?? [], language: "en" });
    }
    throw new Error(`unexpected request to ${url}`);
  };
  const make = (seconds: number, deps: ConstructorParameters<typeof VideoTranscripts>[3] = {}, activity?: SpeechActivity) => {
    post = tweet(seconds);
    return new VideoTranscripts(directory, { target: TARGET, key: "vs-key" }, activity, {
      fetch: upstream, available: async () => true, wait: async () => {},
      sound: async (_video, file) => writeFile(file, Buffer.alloc(seconds * 32000)),
      ...deps,
    });
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "readaloud-transcripts-"));
    pieces = []; sent = []; calls = [];
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("reports a post's video without starting on it", async () => {
    const transcripts = make(2186.617);
    expect(await transcripts.status("20")).toEqual({ state: "none", seconds: 2186.617 });
    expect(await transcripts.status("20")).toEqual({ state: "none", seconds: 2186.617 });
    expect(calls).toEqual(["https://api.fxtwitter.com/status/20"]);
  });

  it("offers nothing for a post without a video, or on a server without ffmpeg", async () => {
    const transcripts = make(60);
    post = { text: "Just words", media: { videos: [{ url: VIDEO, duration: 4, type: "gif" }] } };
    expect(await transcripts.status("20")).toEqual({ state: "none" });
    await expect(transcripts.start("20")).rejects.toMatchObject({ status: 404 });
    const bare = make(60, { available: async () => false });
    expect(await bare.status("21")).toEqual({ state: "none" });
    await expect(bare.start("21")).rejects.toMatchObject({ status: 503 });
    expect(sent).toEqual([]);
  });

  it("hears a long video in pieces that meet at the start of a sentence", async () => {
    const transcripts = make(660);
    pieces = [
      [{ start: 0, end: 280, text: " The first piece." }, { start: 290, end: 300, text: " A sentence cut" }],
      [{ start: 0, end: 12, text: " A sentence cut short by the piece is heard whole." }, { start: 270, end: 300, text: " Another cut" }],
      [{ start: 0, end: 20, text: " Another cut, then the end." }],
    ];
    expect(await transcripts.start("20")).toEqual({ state: "waiting", seconds: 660, done: 0 });
    await transcripts.settled();
    expect(sent).toEqual([
      { seconds: PIECE_SECONDS, mode: "fast", key: "Bearer vs-key" },
      { seconds: PIECE_SECONDS, mode: "fast", key: "Bearer vs-key" },
      { seconds: 100, mode: "fast", key: "Bearer vs-key" },
    ]);
    const done = { state: "done", seconds: 660, text: "The first piece. A sentence cut short by the piece is heard whole. Another cut, then the end." };
    expect(await transcripts.status("20")).toEqual(done);
    expect(calls.filter((url) => url === VIDEO)).toHaveLength(1);

    // Kept on disk: asking again, even after a restart, costs nothing.
    calls = [];
    expect(await make(660).start("20")).toEqual(done);
    expect(calls).toEqual([]);
    expect(JSON.parse(await readFile(join(directory, "20.json"), "utf8"))).toMatchObject({ text: done.text, seconds: 660 });
  });

  it("joins a transcription already under way and shows how far it has got", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const transcripts = make(400, { wait: () => held });
    pieces = [[{ start: 0, end: 300, text: "One long sentence." }], 429, [{ start: 0, end: 100, text: "The rest." }]];
    await transcripts.start("20");
    await expect.poll(() => sent.length).toBe(2);
    expect(await transcripts.start("20")).toEqual({ state: "transcribing", seconds: 400, done: 300 });
    expect(await transcripts.status("20")).toEqual({ state: "transcribing", seconds: 400, done: 300 });
    release();
    await transcripts.settled();
    expect(sent).toHaveLength(3);
    expect(await transcripts.status("20")).toMatchObject({ state: "done", text: "One long sentence. The rest." });
  });

  it("says why a transcription failed and starts again when asked", async () => {
    const transcripts = make(60);
    pieces = [500, 500, 500];
    await transcripts.start("20");
    await transcripts.settled();
    expect(await transcripts.status("20")).toEqual({ state: "failed", seconds: 60, done: 0, error: "The speech server couldn't transcribe the video: pool saturated" });
    pieces = [[]];
    await transcripts.start("20");
    await transcripts.settled();
    expect(await transcripts.status("20")).toMatchObject({ state: "failed", error: "No speech was found in that video." });
    pieces = [[{ start: 0, end: 60, text: "Third time lucky." }]];
    expect(await transcripts.start("20")).toMatchObject({ state: "waiting" });
    await transcripts.settled();
    expect(await transcripts.status("20")).toMatchObject({ state: "done", text: "Third time lucky." });
    await expect(stat(join(directory, "20.json"))).resolves.toBeTruthy();
  });

  it("waits for someone listening, and holds background preparation off while a piece is heard", async () => {
    const activity = new SpeechActivity(60_000);
    const transcripts = make(60, {}, activity);
    pieces = [[{ start: 0, end: 60, text: "Heard after the listener." }]];
    const listening = activity.begin(TARGET);
    await transcripts.start("20");
    await expect.poll(() => calls.includes(VIDEO)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
    listening();
    await transcripts.settled();
    expect(sent).toHaveLength(1);
    expect(activity.pending(TARGET)).toBeGreaterThan(0);
  });

  it("refuses videos too long to transcribe", async () => {
    await expect(make(5 * 60 * 60).start("20")).rejects.toMatchObject({ status: 413 });
  });
});

describe("/api/transcribe", () => {
  let directory: string, server: Server, url: string, transcripts: VideoTranscripts, finish: () => void;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "readaloud-transcripts-"));
    const held = new Promise<void>((resolve) => { finish = resolve; });
    transcripts = new VideoTranscripts(directory, { target: TARGET, key: "" }, undefined, {
      available: async () => true,
      fetch: async (input) => String(input).startsWith("https://api.fxtwitter.com/") ? Response.json({ tweet: tweet(90) }) : new Response("mp4 bytes"),
      sound: async () => { await held; throw new HttpError(502, "Stopped by the test."); },
    });
    const handler = transcribeMiddleware(transcripts);
    server = createServer((req, res) => { req.url = req.url?.replace("/api/transcribe", ""); handler(req, res, () => {}); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/transcribe`;
  });
  afterEach(async () => {
    finish();
    await transcripts.settled();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it("answers for X posts only, and starts on POST from the app itself", async () => {
    const post = encodeURIComponent("https://x.com/joseph_tsar_/status/2122750358493728998/video/1?s=46");
    expect(await (await fetch(`${url}?url=${post}`)).json()).toEqual({ state: "none", seconds: 90 });
    const bad = await fetch(`${url}?url=${encodeURIComponent("https://example.com/watch?v=1")}`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/post on X/);
    expect((await fetch(`${url}?url=${post}`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`${url}?url=${post}`, { method: "POST", headers: { origin: "https://elsewhere.example" } })).status).toBe(403);
    expect(await (await fetch(`${url}?url=${post}`, { method: "POST" })).json()).toMatchObject({ seconds: 90 });
    expect((await (await fetch(`${url}?url=${post}`)).json()).state).toMatch(/waiting|fetching/);
  });
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!ffmpeg)("ffmpeg", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-ffmpeg-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  const stream = (bytes: Buffer) => new Blob([new Uint8Array(bytes)]).stream() as ReadableStream<Uint8Array>;
  const video = (...sound: string[]) => {
    const file = join(directory, "video.mp4");
    const made = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x36:r=5:d=2", ...sound, "-movflags", "+faststart", "-y", file]);
    expect(made.status, made.stderr.toString()).toBe(0);
    return readFile(file);
  };

  it("keeps a piped video's sound as 16 kHz mono samples", async () => {
    const out = join(directory, "sound.pcm");
    await ffmpegSound("ffmpeg")(stream(await video("-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=44100", "-shortest")), out);
    const seconds = (await stat(out)).size / 32000;
    expect(seconds).toBeGreaterThan(1.8);
    expect(seconds).toBeLessThan(2.2);
    expect(wav(await readFile(out)).subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("says so when a video has no sound, or is not a video", async () => {
    const out = join(directory, "sound.pcm");
    await expect(ffmpegSound("ffmpeg")(stream(await video()), out)).rejects.toMatchObject({ status: 422, message: "That video has no sound to transcribe." });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ffmpegSound("ffmpeg")(stream(Buffer.from("not a video")), out)).rejects.toMatchObject({ status: 502 });
    expect(logged).toHaveBeenCalledWith("ffmpeg could not read a video:", expect.stringMatching(/Invalid data/));
    logged.mockRestore();
  });
});
