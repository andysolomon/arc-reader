import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechActivity, isSpeechRequest } from "./vite.speech-activity";

describe("live speech activity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is idle until a live request starts, then quiet only after the grace period", async () => {
    const activity = new SpeechActivity(1000);
    expect(activity.pending("http://mac:3900")).toBe(0);
    const end = activity.begin("http://mac:3900/");
    expect(activity.pending("http://mac:3900")).toBe(Infinity);
    let idle = false;
    void activity.idle("http://mac:3900").then(() => { idle = true; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(idle).toBe(false);
    end();
    end(); // a second call is harmless
    expect(activity.pending("http://mac:3900")).toBe(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toBe(true);
  });

  it("tracks machines separately and overlapping requests", async () => {
    const activity = new SpeechActivity(100);
    const first = activity.begin("http://mac:3900");
    const second = activity.begin("http://mac:3900");
    expect(activity.pending("http://omarchy:3900")).toBe(0);
    first();
    expect(activity.pending("http://mac:3900")).toBe(Infinity);
    second();
    expect(activity.pending("http://mac:3900")).toBe(100);
  });

  it.each([
    ["POST", "/v1/audio/speech", true],
    ["POST", "/api/vs/v1/audio/speech", true],
    ["POST", "/v1/audio/speech?x=1", true],
    ["GET", "/v1/audio/speech", false],
    ["POST", "/v1/audio/voices", false],
    ["POST", "/v1/audio/transcriptions", false],
    [undefined, undefined, false],
  ])("recognises only speech generation: %s %s", (method, url, expected) => {
    expect(isSpeechRequest(method, url)).toBe(expected);
  });
});
