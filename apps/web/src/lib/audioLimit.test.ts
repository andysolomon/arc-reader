import { expect, it } from "vitest";
import { audioLimitChoicesFor, audioLimitFor, isAudioLimitChoice } from "./audioLimit";

const GB = 1024 ** 3;

it("keeps the amount chosen, but never more than half of what the browser allows", () => {
  expect(audioLimitFor(undefined, 1)).toBe(GB);
  expect(audioLimitFor(100 * GB, 5)).toBe(5 * GB);
  expect(audioLimitFor(6 * GB, 5)).toBe(3 * GB);
  expect(audioLimitFor(300 * 1024 ** 2, 1)).toBe(150 * 1024 ** 2);
});

it("takes half of what the browser allows for max, or 1 GB when the browser can't say", () => {
  expect(audioLimitFor(38 * GB, "max")).toBe(19 * GB);
  expect(audioLimitFor(undefined, "max")).toBe(GB);
});

it("offers only the amounts the browser allows, then max", () => {
  expect(audioLimitChoicesFor(undefined)).toEqual([1, 2, 5, 10, 20, "max"]);
  expect(audioLimitChoicesFor(18 * GB)).toEqual([1, 2, 5, "max"]);
  expect(audioLimitChoicesFor(GB)).toEqual(["max"]);
});

it("recognises only the choices offered", () => {
  expect(isAudioLimitChoice(5)).toBe(true);
  expect(isAudioLimitChoice("max")).toBe(true);
  expect(isAudioLimitChoice(3)).toBe(false);
  expect(isAudioLimitChoice("5")).toBe(false);
});
