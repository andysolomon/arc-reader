import { describe, expect, it } from "vitest";
import { hasPatois, patoisChunks } from "./patois";
import type { DocRecord } from "./db";

const rec = (text: string, patois?: DocRecord["patois"]): DocRecord =>
  ({ id: "d", title: "T", text, patois, source: "paste", domain: "Pasted text", chars: text.length, createdAt: 0, updatedAt: 0 }) as DocRecord;

describe("patois", () => {
  it("chunks long text without dropping words", () => {
    const words = Array.from({ length: 3000 }, (_, i) => `word${i}`);
    const text = words.slice(0, 1500).join(" ") + "\n\n" + words.slice(1500).join(" ");
    const chunks = patoisChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 6000)).toBe(true);
    expect(chunks.join(" ").split(/\s+/)).toEqual(words);
  });

  it("keeps short text as one chunk and skips empty text", () => {
    expect(patoisChunks("  Hello there.  ")).toEqual(["Hello there."]);
    expect(patoisChunks("   ")).toEqual([]);
  });

  it("reuses a cached adaptation only while the original is unchanged", () => {
    expect(hasPatois(rec("Hi", { sourceText: "Hi", text: "Wah gwaan", version: 1 }))).toBe(true);
    expect(hasPatois(rec("Hello", { sourceText: "Hi", text: "Wah gwaan", version: 1 }))).toBe(false);
    expect(hasPatois(rec("Hi", { sourceText: "Hi", text: "Wah gwaan", version: 0 }))).toBe(false);
    expect(hasPatois(rec("Hi"))).toBe(false);
  });
});
