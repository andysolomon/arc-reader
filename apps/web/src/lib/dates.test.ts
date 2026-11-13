import { describe, expect, it } from "vitest";
import { agoLabel } from "./dates";

describe("agoLabel", () => {
  const now = Date.UTC(2026, 10, 12, 12);
  const ago = (ms: number) => agoLabel(now - ms, now);
  const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

  it("steps from minutes to years", () => {
    expect(ago(20_000)).toBe("now");
    expect(ago(5 * MINUTE)).toBe("5m");
    expect(ago(6 * HOUR + 59 * MINUTE)).toBe("6h");
    expect(ago(DAY)).toBe("1d");
    expect(ago(6 * DAY)).toBe("6d");
    expect(ago(7 * DAY)).toBe("1w");
    expect(ago(34 * DAY)).toBe("4w");
    expect(ago(35 * DAY)).toBe("1mo");
    expect(ago(364 * DAY)).toBe("12mo");
    expect(ago(800 * DAY)).toBe("2y");
  });

  it("treats a clock running behind as now", () => {
    expect(agoLabel(now + HOUR, now)).toBe("now");
  });
});
