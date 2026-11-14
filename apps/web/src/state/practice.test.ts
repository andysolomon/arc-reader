import { describe, expect, it } from "vitest";
import { EMPTY, applyRound, applyWordAttempt, currentStreak, mastered, toGo } from "./practice";

const at = (day: string) => new Date(`${day}T12:00:00`).getTime();
const round = (missed: string[] = [], clean: string[] = []) => ({ passageId: "p", accuracy: 95, wcpm: 140, phrasing: 3, points: 60, missed, clean });

describe("practice progress", () => {
  it("builds a streak on consecutive days and restarts after a gap", () => {
    let d = applyRound(EMPTY, round(), at("2026-11-12"));
    d = applyRound(d, round(), at("2026-11-12"));
    expect(d.streak).toEqual({ days: 1, lastDay: "2026-11-12" });
    d = applyRound(d, round(), at("2026-11-13"));
    expect(d.streak.days).toBe(2);
    expect(currentStreak(d, "2026-11-14")).toBe(2);
    expect(currentStreak(d, "2026-11-15")).toBe(0);
    d = applyRound(d, round(), at("2026-11-16"));
    expect(d.streak.days).toBe(1);
    expect(d.points).toBe(240);
    expect(d.history).toHaveLength(4);
  });

  it("files missed words and masters them after three clean reads", () => {
    let d = applyRound(EMPTY, round(["Tuckahoe", "authentic"]), at("2026-11-14"));
    d = applyRound(d, round(["authentic"]), at("2026-11-14"));
    expect(toGo(d.words).map((w) => [w.word, w.missed])).toEqual([["authentic", 2], ["Tuckahoe", 1]]);
    d = applyRound(d, round([], ["tuckahoe", "unrelated"]), at("2026-11-14"));
    d = applyWordAttempt(d, "Tuckahoe", true, at("2026-11-14"));
    expect(d.words.tuckahoe.clean).toBe(2);
    expect(d.words.unrelated).toBeUndefined();
    d = applyWordAttempt(d, "Tuckahoe", true, at("2026-11-14"));
    expect(mastered(d.words)).toBe(1);
    expect(toGo(d.words).map((w) => w.word)).toEqual(["authentic"]);
    d = applyWordAttempt(d, "authentic", false, at("2026-11-14"));
    expect(d.words.authentic).toMatchObject({ missed: 3, clean: 0 });
  });
});
