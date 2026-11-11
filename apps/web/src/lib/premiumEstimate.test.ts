import { describe, expect, it } from "vitest";
import type { DocRecord } from "./db";
import { codeKey, readingBlocks } from "./codeBlocks";
import { calibrate, estimatePremium, narrationOf, pendingNote, PRIOR_INPUT_TOKENS_PER_REQUEST, PRIOR_OUTPUT_TOKENS_PER_CHAR, readingCost, spentOn } from "./premiumEstimate";
import { planPassages, segment } from "./segment";
import type { DocSpend, UsageRow } from "./usage";

const rec = (text: string, patch: Partial<DocRecord> = {}): DocRecord =>
  ({ id: "d", title: "T", text, source: "paste", domain: "Pasted text", voice: null, chars: text.length, createdAt: 0, updatedAt: 0, ...patch });
const prose = "The quick brown fox jumps over the lazy dog. ".repeat(40).trim();
const tokenRow = (patch: Partial<UsageRow>): UsageRow => ({ day: "2026-11-05", provider: "openai", model: "gpt-4o-mini-tts", requests: 1, characters: 0, bytes: 0, audioSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, pricing: "", legacy: false, ...patch });
const spend = (patch: Partial<DocSpend>): DocSpend => ({ provider: "fish", model: "s2.1-pro", requests: 1, characters: 0, uniqueCharacters: 0, costUsd: 0, seen: [], updatedAt: 1, ...patch });
const prior = calibrate([], {}, []);

describe("premium estimates", () => {
  it("measures exactly the passages playback would send", () => {
    const text = `${prose}\n\nÉté à Montréal, naïve café.`;
    const passages = planPassages(segment(text).sentences);
    const n = narrationOf(rec(text), prior);
    expect(n.requests).toBe(passages.length);
    expect(n.characters).toBe(passages.reduce((sum, p) => sum + Array.from(p.text).length, 0));
    expect(n.bytes).toBe(passages.reduce((sum, p) => sum + new TextEncoder().encode(p.text).length, 0));
    expect(n.bytes).toBeGreaterThan(n.characters);
  });

  it("prices Fish by bytes and tts-1 by characters at list price", () => {
    const document = rec(prose);
    const n = narrationOf(document, prior);
    const { options } = estimatePremium(document, prior);
    expect(options.find((o) => o.id === "fish")!.costUsd).toBeCloseTo(n.bytes * 15 / 1e6, 10);
    expect(options.find((o) => o.id === "openai-standard")!.costUsd).toBeCloseTo(n.characters * 15 / 1e6, 10);
    const steady = options.find((o) => o.id === "openai-steady")!;
    const input = n.characters * 0.25 + n.requests * PRIOR_INPUT_TOKENS_PER_REQUEST;
    expect(steady.costUsd).toBeCloseTo((input * 0.6 + n.characters * PRIOR_OUTPUT_TOKENS_PER_CHAR * 12) / 1e6, 10);
    expect(steady.lowUsd).toBeLessThan(steady.costUsd);
    expect(steady.highUsd).toBeGreaterThan(steady.costUsd);
    expect(steady.basis).toMatch(/published/);
  });

  it("learns the audio-token rate from paid generations and narrows the range", () => {
    const learned = calibrate([tokenRow({ requests: 200, characters: 60_000, inputTokens: 60_000 * 0.25 + 200 * 50, outputTokens: 60_000 * 2 })], {}, []);
    expect(learned.outputTokensPerChar).toBeGreaterThan(1.9);
    expect(learned.outputTokensPerChar).toBeLessThan(2);
    expect(learned.inputTokensPerRequest).toBeGreaterThan(45);
    expect(learned.inputTokensPerRequest).toBeLessThan(52);
    const document = rec(prose);
    const before = estimatePremium(document, prior).options.find((o) => o.id === "openai-steady")!;
    const after = estimatePremium(document, learned).options.find((o) => o.id === "openai-steady")!;
    expect(after.costUsd).toBeGreaterThan(before.costUsd * 1.5);
    expect((after.highUsd - after.lowUsd) / after.costUsd).toBeLessThan((before.highUsd - before.lowUsd) / before.costUsd);
    expect(after.basis).toMatch(/learned from 200 paid generations/);
  });

  it("ignores legacy, unpriced and character-billed rows when learning token rates", () => {
    const c = calibrate([
      tokenRow({ characters: 50_000, outputTokens: null, inputTokens: null }),
      tokenRow({ model: "tts-1", characters: 50_000, outputTokens: 999_999 }),
      tokenRow({ legacy: true, characters: 50_000, outputTokens: 999_999 }),
    ], {}, []);
    expect(c.outputTokensPerChar).toBe(PRIOR_OUTPUT_TOKENS_PER_CHAR);
    expect(c.tokenRequests).toBe(0);
  });

  it("adds the learned rate of audio paid for twice", () => {
    expect(prior.repeat).toBe(1);
    const c = calibrate([], { a: [spend({ characters: 100_000, uniqueCharacters: 50_000 })] }, []);
    expect(c.repeat).toBeCloseTo(120_000 / 70_000, 6);
    const document = rec(prose);
    expect(readingCost(document, "fish", "s2.1-pro", c)).toBeCloseTo(readingCost(document, "fish", "s2.1-pro", prior)! * c.repeat, 10);
    expect(estimatePremium(document, c).options[0].basis).toMatch(/paid for twice/);
  });

  it("estimates code explanations not written yet from the library's own explanations", () => {
    const text = `${prose}\n\n\`\`\`js\nconsole.log("hi");\n\`\`\``;
    const block = readingBlocks(text).find((b) => b.kind === "code")!;
    const summary = "This prints a greeting to the console so you can confirm the script runs.";
    const library = [rec(text, { id: "x", codeSummaries: { other: "A".repeat(10) + " short explanation of a loop that adds numbers together." } })];
    const c = calibrate([], {}, library);
    expect(c.codeSummaryChars).toBeLessThan(280);
    const pending = narrationOf(rec(text), c);
    expect(pending).toMatchObject({ pendingCode: 1, pendingVisuals: 0 });
    expect(pending.pendingCharacters).toBe(Math.round(c.codeSummaryChars));
    expect(pendingNote(pending)).toBe("Includes 1 code explanation not written yet");
    const explained = narrationOf(rec(text, { codeSummaries: { [codeKey(block as { text: string; language: string })]: summary } }), c);
    expect(explained.pendingCode).toBe(0);
    expect(pendingNote(explained)).toBeNull();
    // Without OpenCode Go the skip notice is what would be spoken.
    expect(narrationOf(rec(text), c, { explainable: false }).pendingCode).toBe(0);
    const range = estimatePremium(rec(text), c).options.find((o) => o.id === "fish")!;
    expect(range.lowUsd).toBeLessThan(range.costUsd);
    expect(range.highUsd).toBeGreaterThan(range.costUsd);
  });

  it("totals what a document has cost so far", () => {
    expect(spentOn(undefined)).toBeNull();
    expect(spentOn([spend({ costUsd: 0.1 }), spend({ provider: "openai", model: "gpt-4o-mini-tts", costUsd: null })])).toEqual({ costUsd: 0.1, unpriced: true });
  });
});
