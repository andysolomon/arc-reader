// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, docs, type DocRecord } from "../lib/db";
import type { TranscriptStatus } from "../lib/videoTranscript";
import { setTranscriptPolling, useTranscripts } from "./transcripts";
import { useToast } from "./toast";

const player = vi.hoisted(() => ({ record: null as { id: string } | null, playing: false, open: vi.fn(async () => true) }));
vi.mock("./player", () => ({ usePlayer: { getState: () => player } }));
vi.mock("./library", () => ({ useLibrary: { getState: () => ({ refresh: async () => {} }) } }));

const POST = "https://x.com/joseph_tsar_/status/2122750358493728998/video/1?s=46";
const record = (id: string, extra: Partial<DocRecord> = {}): DocRecord => ({
  id, title: "A talk", text: "Full course on speaking.", voice: null, chars: 24, source: "url", domain: "x.com", meta: { url: POST, author: "Joseph" }, createdAt: 0, updatedAt: 0, ...extra,
});

describe("transcribing a post's video", () => {
  /** Answers to GET, in order; the last one repeats. */
  let answers: (TranscriptStatus | Error)[];
  let started: TranscriptStatus | Response;
  let requests: string[];
  const video = (id: string) => useTranscripts.getState().videos[id];

  beforeEach(async () => {
    setTranscriptPolling(1);
    useTranscripts.setState({ videos: {}, dismissed: {} });
    player.record = null;
    player.playing = false;
    player.open.mockClear();
    answers = [{ state: "none", seconds: 2186.617 }];
    started = { state: "waiting", seconds: 2186.617, done: 0 };
    requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") return started instanceof Response ? started : Response.json(started);
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      if (answer instanceof Error) throw answer;
      return Response.json(answer);
    }));
    await (await db()).clear("docs");
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("asks about X posts only, once, and never once the transcript is in", async () => {
    const { look } = useTranscripts.getState();
    await look(record("article", { meta: { url: "https://example.com/essay" } }));
    await look(record("pasted", { meta: undefined }));
    await look(record("heard", { transcript: { seconds: 60, at: 1 } }));
    expect(requests).toEqual([]);
    await look(record("post"));
    await look(record("post"));
    expect(requests).toEqual([`GET /api/transcribe?url=${encodeURIComponent(POST)}`]);
    expect(video("post")).toEqual({ state: "none", seconds: 2186.617 });
  });

  it("offers nothing when the server can't be asked", async () => {
    answers = [new Error("offline")];
    await useTranscripts.getState().look(record("post"));
    expect(video("post")).toBeUndefined();
  });

  it("follows the transcription and adds what is said to the document being read", async () => {
    const rec = record("post");
    await docs.put(rec);
    player.record = rec;
    player.playing = true;
    await useTranscripts.getState().look(rec);
    answers = [
      { state: "fetching", seconds: 2186.617, done: 0 },
      new Error("tunnel dropped"),
      { state: "transcribing", seconds: 2186.617, done: 600 },
      { state: "done", seconds: 2186.617, text: "There are only a few dozen people.\n\nThey are verbal athletes." },
    ];
    // Filed while the video was being transcribed: the category must survive.
    const asked = useTranscripts.getState().request(rec);
    expect(video("post")).toEqual({ state: "waiting", seconds: 2186.617, done: 0 });
    await docs.put({ ...rec, category: { name: "Speaking", by: "you", at: 5 } });
    await asked;
    await vi.waitFor(() => expect(video("post")).toBeUndefined());

    const saved = (await docs.get("post"))!;
    expect(saved.text).toBe("Full course on speaking.\n\n## Transcript\n\nThere are only a few dozen people.\n\nThey are verbal athletes.");
    expect(saved).toMatchObject({ chars: saved.text.length, transcript: { seconds: 2186.617 }, category: { name: "Speaking" }, meta: { author: "Joseph" } });
    expect(player.open).toHaveBeenCalledWith(expect.objectContaining({ id: "post", text: saved.text }), { autoplay: true, resume: true });
    expect(useToast.getState().message).toBe("Transcript added");
    expect(requests.filter((r) => r.startsWith("POST"))).toHaveLength(1);
    // The offer is gone for good.
    await useTranscripts.getState().look(saved);
    expect(video("post")).toBeUndefined();
  });

  it("adds a transcript the server already has at once, leaving another document's reading alone", async () => {
    const rec = record("post");
    await docs.put(rec);
    player.record = { id: "something-else" };
    started = { state: "done", seconds: 90, text: "Already heard." };
    await useTranscripts.getState().request(rec);
    expect((await docs.get("post"))!.text).toBe("Full course on speaking.\n\n## Transcript\n\nAlready heard.");
    expect(player.open).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it("picks up a transcription that was already under way", async () => {
    const rec = record("post");
    await docs.put(rec);
    answers = [{ state: "transcribing", seconds: 600, done: 300 }, { state: "transcribing", seconds: 600, done: 450 }, { state: "done", seconds: 600, text: "Heard while away." }];
    await useTranscripts.getState().look(rec);
    expect(video("post")).toMatchObject({ state: "transcribing", done: 300 });
    await vi.waitFor(async () => expect((await docs.get("post"))!.transcript).toBeTruthy());
    expect(requests.every((r) => r.startsWith("GET"))).toBe(true);
  });

  it("shows why it failed, keeps the video's length, and can be retried", async () => {
    const rec = record("post");
    await docs.put(rec);
    await useTranscripts.getState().look(rec);
    started = Response.json({ error: { message: "This server can't read video: ffmpeg is not installed." } }, { status: 503 });
    await useTranscripts.getState().request(rec);
    expect(video("post")).toEqual({ state: "failed", seconds: 2186.617, done: 0, error: "This server can't read video: ffmpeg is not installed." });

    started = { state: "waiting", seconds: 2186.617, done: 0 };
    answers = [{ state: "failed", seconds: 2186.617, done: 300, error: "The speech server couldn't be reached. Please retry." }];
    await useTranscripts.getState().request(rec);
    await vi.waitFor(() => expect(video("post")).toMatchObject({ state: "failed", error: "The speech server couldn't be reached. Please retry." }));

    // A restart of the server loses work in progress.
    answers = [{ state: "none", seconds: 2186.617 }];
    await useTranscripts.getState().request(rec);
    await vi.waitFor(() => expect(video("post")).toMatchObject({ state: "failed", seconds: 2186.617, error: expect.stringMatching(/restarted/) }));
    expect((await docs.get("post"))!.text).toBe("Full course on speaking.");
  });
});
