/**
 * Phase 0 of Reading Practice: does Gemini Decision 1 catch misreadings in audio?
 *
 *   pnpm --filter @readaloud/web practice:eval [--per-band 2] [--recordings DIR]
 *
 * For a few bundled passages per band it makes readings with known mistakes — two words swapped
 * for others, one skipped, one inserted, one long word respelled so the voice mispronounces it —
 * plus a clean read. Each reading is spoken by Phonon through the app (PRACTICE_EVAL_URL, default
 * the deployed app), converted to 16 kHz mono WAV with ffmpeg, and judged through /api/decide
 * with the ORIGINAL passage's questions. It prints, per variant and overall, how many planted
 * mistakes were caught and how many untouched words were wrongly flagged.
 *
 * --recordings DIR adds real takes: for each NAME.json ({ "passageId": "...", "mistakes":
 * { "<word index>": "mispronounced" | "substituted" | "skipped" } }) it judges NAME.wav, .m4a or .webm.
 *
 * Pass: under 3% of clean words flagged and at least 80% of planted mistakes caught.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRACTICE_PASSAGES } from "../src/data/practicePassages";
import { interpretJudgement, judgeRequest, type Verdict } from "../src/lib/practice/judge";
import { tokens } from "../src/lib/practice/words";

const BASE = (process.env.PRACTICE_EVAL_URL ?? "https://omarchy.tail1b9428.ts.net:8449").replace(/\/$/, "");
const VOICE = process.env.PRACTICE_EVAL_VOICE ?? "Easton";
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const perBand = Number(flag("--per-band") ?? 2);
const recordings = flag("--recordings");
const work = mkdtempSync(join(tmpdir(), "practice-eval-"));

type Expected = Record<number, Exclude<Verdict, "correct" | "unsure">>;
interface Case { name: string; passage: string; audio: () => Promise<string>; expected: Expected }

/** Seeded so the same mistakes are planted on every run. */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const SWAPS = ["house", "river", "quickly", "orange", "table", "music", "garden", "seven"];

async function speak(text: string, file: string): Promise<string> {
  const r = await fetch(`${BASE}/api/phonon/v1/audio/speech`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "tts-1", input: text, voice: VOICE, response_format: "mp3", speed: 1 }),
  });
  if (!r.ok) throw new Error(`Speech failed (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
  const mp3 = join(work, `${file}.mp3`);
  writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
  return toWavBase64(mp3);
}

function toWavBase64(input: string): string {
  const wav = `${input}.wav`;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-ac", "1", "-ar", "16000", wav]);
  return readFileSync(wav).toString("base64");
}

/** The passage read aloud with mistakes planted; returns the text to speak and what the judge should find. */
function variants(id: string, passage: string): Case[] {
  const words = tokens(passage);
  const random = rng([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const pick = (ok: (i: number) => boolean) => {
    for (let n = 0; n < 200; n++) { const i = 2 + Math.floor(random() * (words.length - 4)); if (ok(i)) return i; }
    return 3;
  };
  const spoken = (edit: (i: number) => string | null) => words.map((t, i) => { const w = edit(i); return w === null ? "" : `${i && t.space ? " " : ""}${t.pre}${w}${t.post}`; }).join("").replace(/\s+/g, " ").trim();
  const long = (i: number) => words[i].word.length >= 7 && /^[a-z]+$/i.test(words[i].word);
  const plain = (i: number) => /^[a-z]+$/i.test(words[i].word) && words[i].word.length >= 4;
  const a = pick(plain), b = pick((i) => plain(i) && Math.abs(i - a) > 4);
  const skip = pick((i) => plain(i));
  const insertAt = pick(() => true);
  const garble = pick(long);
  const respell = (w: string) => w.slice(0, 2) + [...w.slice(2, -2)].reverse().join("") + w.slice(-2);
  const make = (name: string, text: string, expected: Expected): Case => ({ name: `${id} · ${name}`, passage, expected, audio: () => speak(text, `${id}-${name}`) });
  return [
    make("clean", spoken((i) => words[i].word), {}),
    make("2 swapped", spoken((i) => (i === a ? SWAPS[a % SWAPS.length] : i === b ? SWAPS[b % SWAPS.length] : words[i].word)), { [a]: "substituted", [b]: "substituted" }),
    make("1 skipped", spoken((i) => (i === skip ? null : words[i].word)), { [skip]: "skipped" }),
    make("1 inserted", spoken((i) => (i === insertAt ? `${words[i].word} very` : words[i].word)), {}),
    make("1 mispronounced", spoken((i) => (i === garble ? respell(words[i].word) : words[i].word)), { [garble]: "mispronounced" }),
  ];
}

function realCases(dir: string): Case[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const spec = JSON.parse(readFileSync(join(dir, f), "utf8")) as { passageId: string; mistakes?: Record<string, Expected[number]> };
    const passage = PRACTICE_PASSAGES.find((p) => p.id === spec.passageId)?.text;
    if (!passage) throw new Error(`${f}: no bundled passage ${spec.passageId}`);
    const base = f.replace(/\.json$/, "");
    const audio = [".wav", ".m4a", ".webm", ".mp3"].map((e) => join(dir, base + e)).find(existsSync);
    if (!audio) throw new Error(`${f}: no recording beside it`);
    const expected = Object.fromEntries(Object.entries(spec.mistakes ?? {}).map(([k, v]) => [Number(k), v])) as Expected;
    return { name: `real · ${base}`, passage, expected, audio: async () => toWavBase64(audio) };
  });
}

const bands = ["6-8", "9-12", "college", "advanced"] as const;
const cases = [
  ...bands.flatMap((band) => PRACTICE_PASSAGES.filter((p) => p.band === band).slice(0, perBand).flatMap((p) => variants(p.id, p.text))),
  ...(recordings ? realCases(recordings) : []),
];

let cleanWords = 0, falseFlags = 0, planted = 0, caught = 0, sure = 0, rightKind = 0, unsure = 0;
console.log(`Judging ${cases.length} readings through ${BASE}/api/decide …\n`);
for (const c of cases) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/decide/v1/systemone`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(judgeRequest(c.passage, { data: await c.audio(), format: "wav" })),
  });
  const data = await response.json().catch(() => null) as { answers?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!response.ok) { console.error(`${c.name}: HTTP ${response.status} ${data?.error?.message ?? ""}`); process.exit(1); }
  const j = interpretJudgement(c.passage, data as never);
  const flagged = j.words.filter((w) => w.verdict !== "correct" && w.verdict !== "unsure" && !(w.index in c.expected));
  const hits = Object.entries(c.expected).filter(([i]) => j.words[Number(i)].verdict !== "correct");
  cleanWords += j.words.length - Object.keys(c.expected).length;
  falseFlags += flagged.length;
  planted += Object.keys(c.expected).length;
  caught += hits.length;
  sure += hits.filter(([i]) => j.words[Number(i)].verdict !== "unsure").length;
  rightKind += hits.filter(([i, kind]) => j.words[Number(i)].verdict === kind).length;
  unsure += j.words.filter((w) => w.verdict === "unsure").length;
  console.log(`${c.name.padEnd(48)} caught ${hits.length}/${Object.keys(c.expected).length}  false flags ${flagged.length}${flagged.length ? ` (${flagged.map((w) => `${w.word}:${w.verdict}`).join(", ")})` : ""}  off-script ${j.offScript}  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
console.log(`\nPlanted mistakes caught: ${caught}/${planted} (${pct(caught, planted)}); caught with confidence ≥ 0.7: ${pct(sure, planted)}; right kind: ${pct(rightKind, planted)}`);
console.log(`Untouched words wrongly flagged: ${falseFlags}/${cleanWords} (${pct(falseFlags, cleanWords)}); words marked unclear: ${unsure}`);
const pass = planted > 0 && sure / planted >= 0.8 && falseFlags / cleanWords < 0.03;
console.log(pass ? "PASS: the audio judge meets the Phase 0 bar." : "FAIL: below the Phase 0 bar (≥ 80% caught with confidence, < 3% false flags).");
process.exit(pass ? 0 : 2);
