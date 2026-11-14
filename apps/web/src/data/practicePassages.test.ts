// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BANDS, bandInfo } from "../lib/practice/bands";
import { PRACTICE_PASSAGES } from "./practicePassages";

const count = (text: string) => text.split(/\s+/).filter(Boolean).length;

const DOUGLASS =
  "I was born in Tuckahoe, near Hillsborough, and about twelve miles from Easton, in Talbot county, Maryland. I have no accurate knowledge of my age, never having seen any authentic record containing it. By far the larger part of the slaves know as little of their ages as horses know of theirs, and it is the wish of most masters within my knowledge to keep their slaves thus ignorant.";

describe("PRACTICE_PASSAGES", () => {
  it("has unique kebab-case ids", () => {
    const ids = PRACTICE_PASSAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has ten passages per band, ordered by band", () => {
    for (const band of BANDS) expect(PRACTICE_PASSAGES.filter((p) => p.band === band.id)).toHaveLength(10);
    const order = BANDS.map((b) => b.id);
    const positions = PRACTICE_PASSAGES.map((p) => order.indexOf(p.band));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps every passage inside its band's word range", () => {
    for (const p of PRACTICE_PASSAGES) {
      const { min, max } = bandInfo(p.band);
      expect({ id: p.id, words: count(p.text), ok: count(p.text) >= min && count(p.text) <= max }).toMatchObject({ ok: true });
    }
  });

  it("ends every passage at the end of a sentence", () => {
    for (const p of PRACTICE_PASSAGES) expect(p.text, p.id).toMatch(/[.!?]["”’]?$/);
  });

  it("stores clean, single-spaced text", () => {
    for (const p of PRACTICE_PASSAGES) {
      expect(p.text, p.id).toBe(p.text.trim());
      expect(p.text, p.id).not.toMatch(/ {2}|\n|\r|_|\.\.\.|…/);
    }
  });

  it("names a title, an author, and the work's Project Gutenberg page", () => {
    for (const p of PRACTICE_PASSAGES) {
      expect(p.title.trim(), p.id).not.toBe("");
      expect(p.author.trim(), p.id).not.toBe("");
      expect(p.url, p.id).toMatch(/^https:\/\/www\.gutenberg\.org\/ebooks\/\d+$/);
    }
  });

  it("uses no work more than twice", () => {
    const uses = new Map<string, number>();
    for (const p of PRACTICE_PASSAGES) uses.set(p.url, (uses.get(p.url) ?? 0) + 1);
    for (const [url, n] of uses) expect(n, url).toBeLessThanOrEqual(2);
  });

  it("includes the opening of Douglass's Narrative in grades 9–12", () => {
    const douglass = PRACTICE_PASSAGES.find((p) => p.id === "douglass-narrative-birth");
    expect(douglass).toMatchObject({ band: "9-12", url: "https://www.gutenberg.org/ebooks/23" });
    expect(douglass?.text.startsWith(DOUGLASS)).toBe(true);
  });
});
