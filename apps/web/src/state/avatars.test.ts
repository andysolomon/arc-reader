// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAvatarSync, useAvatars, avatarReviewNote } from "./avatars";
import { useVoices } from "./voices";
import { PRESET_VOICES, type Voice } from "../data/voices";

const voice: Voice = { id: "fresh", name: "New voice", engine: "omnivoice", kind: "profile", hue: 155, lang: "EN", tags: ["cloned"] };
let stop: (() => void) | undefined;
const initialVoices = useVoices.getState();
beforeEach(() => { useAvatars.setState({ configured: false, entries: {} }); useVoices.setState({ voices: [PRESET_VOICES[0], voice], loaded: true }); });
afterEach(() => { stop?.(); stop = undefined; useVoices.setState(initialVoices, true); vi.unstubAllGlobals(); });

it("automatically creates only uncurated voices and reacts to later additions", async () => {
  const records: unknown[] = [];
  const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const v = JSON.parse(init.body as string).voice;
      const entry = { identity: `profile:${v.id}`, status: "queued" };
      records.push(entry);
      return Response.json(entry);
    }
    return Response.json({ configured: true, records });
  });
  vi.stubGlobal("fetch", upstream);
  stop = startAvatarSync();
  await vi.waitFor(() => expect(records).toHaveLength(1));
  expect(useAvatars.getState().entries["profile:fresh"].status).toBe("queued");
  useVoices.setState({ voices: [...useVoices.getState().voices, { ...voice, id: "later" }] });
  await vi.waitFor(() => expect(records).toHaveLength(2));
  const requests = upstream.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(requests.map(([, init]) => JSON.parse(init!.body as string).voice.id)).toEqual(["fresh", "later"]);
});

it("keeps failed records for explicit retry and skips generation without credentials", async () => {
  const upstream = vi.fn(async () => Response.json({ configured: true, records: [{ identity: "profile:fresh", status: "failed", error: "Quota" }] }));
  vi.stubGlobal("fetch", upstream);
  stop = startAvatarSync();
  await vi.waitFor(() => expect(useAvatars.getState().entries["profile:fresh"].status).toBe("failed"));
  expect(upstream).toHaveBeenCalledTimes(1);
  stop();
  upstream.mockResolvedValue(Response.json({ configured: false, records: [] }));
  stop = startAvatarSync();
  await vi.waitFor(() => expect(useAvatars.getState().configured).toBe(false));
  expect(upstream).toHaveBeenCalledTimes(2);
});

it("deduplicates manual and automatic requests in the same client", async () => {
  const upstream = vi.fn(async () => Response.json({ identity: "profile:fresh", status: "queued" }));
  vi.stubGlobal("fetch", upstream);
  await Promise.all([useAvatars.getState().ensure(voice), useAvatars.getState().ensure(voice)]);
  expect(upstream).toHaveBeenCalledTimes(1);
});

it("shows metadata review notes without exposing internal service details", () => {
  const entry = { identity: "profile:fresh", status: "ready" as const, review: { status: "reviewed" as const, warnings: ["gender-conflicting"] } };
  expect(avatarReviewNote(entry)).toContain("conflicting");
  expect(avatarReviewNote({ ...entry, review: { ...entry.review, warnings: ["gender-missing", "age-missing"] } })).toContain("age and gender");
  expect(avatarReviewNote({ ...entry, review: { ...entry.review, warnings: [] } })).toBeUndefined();
});
