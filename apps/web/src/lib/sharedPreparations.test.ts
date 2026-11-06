import { visualBlock, visualKey } from "./visuals";
import { describe, expect, it } from "vitest";
import { PRESET_VOICES } from "../data/voices";
import type { SharedPreparation } from "../engine/preparation";
import { cacheKey } from "../engine/providers";
import type { DocRecord } from "./db";
import { sharedPreparationJobs } from "./sharedPreparations";

const voice = PRESET_VOICES[0];
const rec: DocRecord = { id: "a", title: "Shared reading", text: "First passage.\n\nSecond passage.", source: "paste", domain: "Text", voice: null, chars: 31, createdAt: 1, updatedAt: 1 };
const keys = ["First passage.", "Second passage."].map((text) => cacheKey({ text, voice: voice.id, engine: voice.engine }));
const job: SharedPreparation = { id: "server-job", state: "running", keys, available: [0], voice: voice.id, engine: voice.engine, done: 1, total: 2, worker: "Mac", queued: false, createdAt: 1 };

describe("shared preparation jobs", () => {
  it("shows the server worker and passage progress without a local preparation queue", () => {
    expect(sharedPreparationJobs([rec], [job], () => voice)).toEqual([expect.objectContaining({ docId: "a", serverId: "server-job", remote: true, status: "preparing", done: 1, total: 2, worker: "Mac" })]);
    expect(sharedPreparationJobs([{ ...rec, text: "Changed document." }], [job], () => voice)).toEqual([]);
  });
  it("finds shared audio using the saved visual description", () => {
    const visual = { kind: "image" as const, src: "https://example.com/photo.png", alt: "A bird", caption: "" };
    const description = "A bird rests on a branch.";
    const document = { ...rec, text: visualBlock(visual), visualDescriptions: { [visualKey(visual)]: description } };
    const reading = { ...job, total: 1, done: 1, keys: [cacheKey({ text: description, voice: voice.id, engine: voice.engine })] };
    expect(sharedPreparationJobs([document], [reading], () => voice)[0].docId).toBe(rec.id);
    expect(sharedPreparationJobs([{ ...document, visualDescriptions: {} }], [reading], () => voice)).toEqual([]);
  });
  it("prefers active work over historical readings and distinguishes device-only audio", () => {
    const older: SharedPreparation = { ...job, id: "old", state: "done", done: 2, available: [], createdAt: 0 };
    expect(sharedPreparationJobs([rec], [older, job], () => voice)).toHaveLength(1);
    expect(sharedPreparationJobs([rec], [older, job], () => voice)[0].serverId).toBe(job.id);
    expect(sharedPreparationJobs([rec], [older], () => voice)[0].message).toContain("original device");
  });
});
