// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { bundledPassage, nextPassage, type PassageDeps } from "./passages";
import type { Screening } from "./screen";

const story = (text: string, n = 1) => ({ text, title: `Story ${n}`, url: `https://www.npr.org/nx-${n}` });
const easy = "The city council met on Tuesday night. " .repeat(9).trim();
const screen = (level: Screening["level"], unsuitable = 0.02, confidence = 0.9): Screening => ({ level, confidence, unsuitable });
const deps = (over: Partial<PassageDeps>): PassageDeps => ({
  npr: vi.fn(async () => story(easy)),
  screen: vi.fn(async () => screen("6-8")),
  ...over,
});
const always = (v: number) => () => v;

describe("nextPassage", () => {
  it("uses bundled passages for Advanced and when the coin says so", async () => {
    const d = deps({});
    expect((await nextPassage("advanced", { random: always(0.1), deps: d })).source).toBe("public-domain");
    expect((await nextPassage("9-12", { random: always(0.9), deps: d })).source).toBe("public-domain");
    expect(d.npr).not.toHaveBeenCalled();
  });

  it("keeps an NPR passage Jev rates for the band", async () => {
    const d = deps({ screen: vi.fn(async () => screen("6-8")) });
    const p = await nextPassage("6-8", { random: always(0.1), deps: d });
    expect(p).toMatchObject({ source: "npr", text: easy, url: "https://www.npr.org/nx-1" });
  });

  it("falls back to a bundled passage when NPR's is unsuitable, too hard, or a service fails", async () => {
    const unsuitable = deps({ screen: vi.fn(async () => screen("6-8", 0.8)) });
    expect((await nextPassage("6-8", { random: always(0.1), deps: unsuitable })).source).toBe("public-domain");
    // A passage Jev rates above the level is passed over, never rewritten down to it.
    const harder = deps({ screen: vi.fn(async () => screen("9-12")) });
    expect((await nextPassage("6-8", { random: always(0.1), deps: harder })).source).toBe("public-domain");
    const failing = deps({ screen: vi.fn(async () => { throw new Error("no key"); }) });
    expect((await nextPassage("9-12", { random: always(0.1), deps: failing })).source).toBe("public-domain");
    const rejected = deps({ screen: vi.fn(async () => screen("college")) });
    expect((await nextPassage("9-12", { random: always(0.1), deps: rejected })).source).toBe("public-domain");
    expect(rejected.npr).toHaveBeenCalledTimes(2);
  });
});

describe("bundledPassage", () => {
  it("avoids recent passages while any are left", () => {
    const first = bundledPassage("college", [], always(0));
    expect(bundledPassage("college", [first.id], always(0)).id).not.toBe(first.id);
  });
});
