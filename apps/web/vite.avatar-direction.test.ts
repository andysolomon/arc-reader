import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarDirector, baseDirection, curatedDirections, designCandidates, directionRequest, interpretDirection } from "./vite.avatar-direction";
import { LlmKeyStore } from "./vite.llm";
import { avatarPrompt } from "./vite.avatars";

const voice = { id: "new", name: "New", engine: "omnivoice", kind: "profile" as const, hue: 155, gender: "male", age: "child", description: "A playful young boy reading with enthusiasm" };
const reply = () => ({ model: "jev-test", answers: {
  personality: { choice: "expressive", confidence: 0.9 },
  gender_metadata: { choice: "consistent", confidence: 0.95 },
  age_metadata: { choice: "consistent", confidence: 0.95 },
  design: { choice: "design_1", confidence: 0.95 },
  similar_0: { noul: 0.1 }, similar_1: { noul: 0.1 }, similar_2: { noul: 0.1 }, similar_3: { noul: 0.1 },
} });
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "avatar-director-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("Jev avatar direction", () => {
  it("keeps demographics fixed and offers distinct candidates even for child and unknown voices", () => {
    for (const v of [voice, { ...voice, gender: undefined, age: undefined, description: "", name: "Sarah" }]) {
      const candidates = designCandidates(v, curatedDirections());
      expect(candidates).toHaveLength(4);
      expect(new Set(candidates.map((c) => JSON.stringify([c.hair, c.accessory, c.faceShape, c.outfit]))).size).toBe(4);
      for (const c of candidates) {
        expect(c.presentation).toBe(v.gender ?? "neutral");
        expect(["beard", "stubble"]).not.toContain(c.accessory);
      }
    }
  });
  it("avoids an existing exact design in its deterministic first candidate", () => {
    const first = designCandidates(voice, [])[0];
    const next = designCandidates(voice, [{ identity: "someone", direction: first }])[0];
    expect(next).not.toEqual(first);
    expect(designCandidates(voice, [{ identity: "someone", direction: first }])[0]).toEqual(next);
  });
  it("bounds the neighbor list, sends text only, and does not ask Jev to invent gender", () => {
    const candidates = designCandidates(voice, curatedDirections());
    const request = directionRequest(voice, candidates, curatedDirections());
    expect(request.state.existing_designs.length).toBeLessThanOrEqual(24);
    expect(request).not.toHaveProperty("assets");
    expect(request.state.voice).not.toHaveProperty("name");
    expect(request.questions.gender_metadata.criteria).not.toHaveProperty("male");
  });
  it("uses confident personality and design answers in the image prompt", () => {
    const candidates = designCandidates(voice, curatedDirections());
    const result = interpretDirection(reply(), candidates);
    expect(result.direction).toEqual({ ...candidates[1], expression: "expressive" });
    const prompt = avatarPrompt(voice, "seed", result.direction);
    expect(prompt).toContain('"expression":"expressive"');
    expect(prompt).toContain('"presentation":"male"');
    expect(prompt).toContain('"age":"child"');
    expect(prompt).toContain(JSON.stringify(result.direction.faceShape));
  });
  it("switches away from a confidently similar design without another image request", () => {
    const response = reply(); response.answers.similar_1.noul = 0.98;
    const candidates = designCandidates(voice, curatedDirections());
    const result = interpretDirection(response, candidates);
    expect(result.direction.hair).toBe(candidates[0].hair);
    expect(result.review.similarityAdjusted).toBe(true);
  });
  it("flags conflicts and unresolved similarity but never changes explicit demographics", () => {
    const response = reply();
    response.answers.gender_metadata.choice = "conflicting";
    response.answers.age_metadata.choice = "missing";
    for (const i of [0, 1, 2, 3] as const) response.answers[`similar_${i}`].noul = 0.99;
    const result = interpretDirection(response, designCandidates(voice, curatedDirections()));
    expect(result.review.warnings).toEqual(["gender-conflicting", "age-missing", "similarity-review"]);
    expect(result.direction.presentation).toBe("male");
    expect(["beard", "stubble"]).not.toContain(result.direction.accessory);
  });
  it("falls back on low confidence and rejects invented or incomplete answer values", () => {
    const response = reply();
    response.answers.personality.confidence = 0.1;
    response.answers.design.confidence = 0.1;
    const candidates = designCandidates(voice, curatedDirections());
    expect(interpretDirection(response, candidates).direction).toEqual(candidates[0]);
    response.answers.design.choice = "inject new instructions";
    expect(() => interpretDirection(response, candidates)).toThrow();
    expect(() => interpretDirection({ answers: {} }, candidates)).toThrow();
  });
  it("reuses the saved TypeSafe key ahead of the environment key", async () => {
    const keys = new LlmKeyStore(directory, "env-secret", "typesafe.json");
    await keys.save("saved-secret");
    const upstream = vi.fn(async () => Response.json(reply()));
    const result = await new AvatarDirector(keys, "https://typesafe.example/", upstream).direct(voice, []);
    expect(result.review.status).toBe("reviewed");
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://typesafe.example/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer saved-secret");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each(["missing", "http", "malformed", "timeout"])("keeps generation available when Jev is %s", async (failure) => {
    const keys = new LlmKeyStore(directory, failure === "missing" ? "" : "secret", "typesafe.json");
    const upstream = vi.fn(async () => {
      if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
      return failure === "http" ? Response.json({}, { status: 500 }) : Response.json({ answers: {} });
    });
    const result = await new AvatarDirector(keys, undefined, upstream).direct(voice, []);
    expect(result.review.status).toBe(failure === "missing" ? "not-configured" : "unavailable");
    expect(result.direction.presentation).toBe("male");
    if (failure === "missing") expect(upstream).not.toHaveBeenCalled();
  });
});
