import { expect, it } from "vitest";
import { PRESET_VOICES } from "../data/voices";
import { cacheKey, cacheKeyPrefix } from "../engine/providers";
import { bytesPerChar, learnRates, remainingBytes } from "./audioSize";
import type { DocRecord } from "./db";
import { planReading } from "./prepared";

const rec: DocRecord = { id: "d", title: "Document", text: "One two. Three four.\n\nFive six.", source: "paste", domain: "Text", voice: null, chars: 32, createdAt: 0, updatedAt: 0 };
const [bella] = PRESET_VOICES;
const prefix = cacheKeyPrefix({ voice: bella.id, engine: bella.engine, openaiModel: "" });
const key = (text: string) => cacheKey({ text, voice: bella.id, engine: bella.engine, openaiModel: "" });
const phonon = "phonon:gradium/phonon-31m-en|phonon:Easton|";

it("starts from the measured rates and moves towards what the device saved", () => {
  expect(bytesPerChar(new Map(), phonon)).toBe(560);
  expect(bytesPerChar(new Map(), prefix)).toBe(950);
  // 2,000 characters at 2,000 bytes each weigh the same as the measured rate.
  expect(bytesPerChar(new Map([[prefix, { bytes: 4_000_000, characters: 2_000 }]]), prefix)).toBe(1475);
});

it("learns a voice's rate from the clips whose text is in the library", () => {
  const sizes = new Map([[key("One two. Three four."), 20_000], [key("Five six."), 9_000], ["other|voice|ffffffff", 1_000]]);
  expect(learnRates([planReading(rec)], sizes).get(prefix)).toEqual({ bytes: 29_000, characters: 29 });
});

it("counts only the narration not saved on the device", () => {
  const plan = planReading(rec);
  const rate = bytesPerChar(new Map(), prefix);
  expect(remainingBytes(plan, false, prefix, new Set(), new Map())).toBe(Math.round(29 * rate));
  expect(remainingBytes(plan, false, prefix, new Set([key("One two. Three four.")]), new Map())).toBe(Math.round(9 * rate));
  // A sentence playback saved on its own counts as saved too.
  expect(remainingBytes(plan, false, prefix, new Set([key("One two."), key("Five six.")]), new Map())).toBe(Math.round(12 * rate));
});
