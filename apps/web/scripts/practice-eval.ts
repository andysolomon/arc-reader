/**
 * How well does Reading Practice's judge find misreadings? (Phase 0 of the plan.)
 *
 *   pnpm --filter @readaloud/web practice:eval [--per-band 2] [--recordings DIR] [--dump FILE]
 *
 * For a few bundled passages per band it makes readings with known mistakes — two words swapped
 * for others, one skipped, one inserted, one long word respelled so the voice mispronounces it —
 * plus a clean read. Each reading is spoken by Phonon through the app (PRACTICE_EVAL_URL, default
 * the deployed app), converted to 16 kHz mono WAV with ffmpeg, and judged the way the app judges
 * it: the speech server's transcript lined up against the ORIGINAL passage (hearTake), and
 * Gemini Decision 1 for phrasing, expression and pace through /api/decide. It prints, per reading
 * and overall, how many planted mistakes were caught and how many untouched words were flagged.
 *
 * --dump FILE also writes every reading's verdicts as JSON.
 * --live also plays each reading to the live coach a few seconds at a time, as the app hears it
 * while recording, and reports what it had marked by the end.
 * --recordings DIR adds real takes: for each NAME.json ({ "passageId": "...", "mistakes":
 * { "<word index>": "mispronounced" | "substituted" | "skipped" } }) it judges NAME.wav, .m4a or .webm.
 *
 * Pass: under 3% of clean words flagged and at least 80% of planted mistakes caught.
 *
 * 2026-11-14, 40 synthetic readings with 32 planted mistakes: asking Gemini Decision about every
 * word in the audio caught 31–44% (9–13% with confidence) and never a skipped word, so the words
 * are judged from a transcript instead.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRACTICE_PASSAGES } from "../src/data/practicePassages";
import { tokens } from "../src/lib/practice/words";
import { hearTake, interpretProsody, prosodyRequest, type Verdict } from "../src/lib/practice/judge";
import { LIVE_START, advanceLive, type Segment } from "../src/lib/practice/live";

const BASE = (process.env.PRACTICE_EVAL_URL ?? "https://omarchy.tail1b9428.ts.net:8449").replace(/\/$/, "");
const VOICE = process.env.PRACTICE_EVAL_VOICE ?? "Easton";
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const perBand = Number(flag("--per-band") ?? 2);
const recordings = flag("--recordings");
/** --dump FILE writes every word's probabilities, to study thresholds. */
const dump = flag("--dump");
const dumped: unknown[] = [];
const liveMode = args.includes("--live");
/** Seconds of reading between two live transcripts, about what the app manages. */
const LIVE_STEP = 2.6;
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

/** The reading as Whisper hears it, through the app's VoiceStudio proxy (no vocabulary hint, no clean-up). */
async function transcribeFull(wav: Blob, mode: "fast" | "accurate"): Promise<{ text: string; segments: Segment[] }> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.set("audio", wav, "reading.wav");
    form.set("mode", mode);
    const r = await fetch(`${BASE}/api/vs/transcribe`, { method: "POST", body: form });
    if (r.status === 429 && attempt < 5) { await new Promise((done) => setTimeout(done, 5000)); continue; }
    if (!r.ok) throw new Error(`Transcription failed (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
    const data = (await r.json()) as { text?: string; segments?: Segment[] };
    return { text: data.text ?? "", segments: data.segments ?? [] };
  }
}
const transcribe = async (wav: Blob, mode: "fast" | "accurate") => (await transcribeFull(wav, mode)).text;

/** The samples of a 16-bit mono WAV, and a WAV of a stretch of them. */
function pcmOf(wav: Buffer): { samples: Int16Array; rate: number } {
  const at = wav.indexOf("data", 12, "latin1");
  const bytes = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  return { samples: new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2)), rate: wav.readUInt32LE(24) };
}
function wavOf(samples: Int16Array, rate: number): Blob {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + samples.length * 2, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(samples.length * 2, 40);
  return new Blob([head, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)], { type: "audio/wav" });
}

/** The live coach's state after hearing a take the way the app does: the unsettled audio every few seconds. */
async function liveRun(passage: string, wav: Buffer) {
  const all = tokens(passage);
  const { samples, rate } = pcmOf(wav);
  const duration = samples.length / rate;
  let state = LIVE_START, asks = 0;
  for (let t = LIVE_STEP; ; t += LIVE_STEP) {
    const until = Math.min(t, duration);
    if (until - state.audioFrom >= 2) {
      const window = samples.subarray(Math.round(state.audioFrom * rate), Math.round(until * rate));
      const segments = (await transcribeFull(wavOf(window, rate), "fast")).segments;
      state = advanceLive(state, all, segments);
      asks++;
      if (process.env.LIVE_DEBUG) console.log(`      ${state.audioFrom.toFixed(1)}–${until.toFixed(1)}s settled ${state.words.length} cursor ${state.cursor} | ${segments.map((g) => `[${g.start.toFixed(1)}-${g.end.toFixed(1)}]${g.text}`).join(" ")}`.slice(0, 420));
    }
    if (until >= duration) break;
  }
  return { state, asks, duration, total: all.length };
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
/** --only TEXT keeps the readings whose name contains it. */
const only = flag("--only");
const cases = [
  ...bands.flatMap((band) => PRACTICE_PASSAGES.filter((p) => p.band === band).slice(0, perBand).flatMap((p) => variants(p.id, p.text))),
  ...(recordings ? realCases(recordings) : []),
].filter((c) => !only || c.name.includes(only));

let cleanWords = 0, falseFlags = 0, cleanUnsure = 0, planted = 0, caught = 0, sure = 0, rightKind = 0, secondPasses = 0;
const liveTotals = { planted: 0, caught: 0, flags: 0, settled: 0, cursor: 0, words: 0, asks: 0 };
console.log(`Judging ${cases.length} readings through ${BASE} …\n`);
for (const c of cases) {
  const started = Date.now();
  const data = await c.audio();
  const wav = new Blob([Buffer.from(data, "base64")], { type: "audio/wav" });
  const modes: string[] = [];
  const [hearing, prosody] = await Promise.all([
    hearTake(c.passage, wav, undefined, (blob, mode) => { modes.push(mode); return transcribe(blob, mode); }),
    fetch(`${BASE}/api/decide/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prosodyRequest(c.passage, { data, format: "wav" })) })
      .then(async (r) => (r.ok ? interpretProsody(await r.json()) : `HTTP ${r.status}`)).catch((e: Error) => e.message),
  ]);
  if (modes.length > 1) secondPasses++;
  const words = hearing.words;
  const marked = (v: Verdict) => v !== "correct" && v !== "unsure";
  const flagged = words.filter((w) => marked(w.verdict) && !(w.index in c.expected));
  const doubted = words.filter((w) => w.verdict === "unsure" && !(w.index in c.expected));
  const hits = Object.entries(c.expected).filter(([i]) => words[Number(i)].verdict !== "correct");
  cleanWords += words.length - Object.keys(c.expected).length;
  falseFlags += flagged.length;
  cleanUnsure += doubted.length;
  planted += Object.keys(c.expected).length;
  caught += hits.length;
  sure += hits.filter(([i]) => marked(words[Number(i)].verdict)).length;
  rightKind += hits.filter(([i, kind]) => words[Number(i)].verdict === kind).length;
  let liveNote = "";
  if (liveMode) {
    const run = await liveRun(c.passage, Buffer.from(data, "base64"));
    const liveMarks = run.state.words.filter((w) => marked(w.verdict));
    const liveHits = liveMarks.filter((w) => w.index in c.expected);
    liveTotals.planted += Object.keys(c.expected).length; liveTotals.caught += liveHits.length; liveTotals.flags += liveMarks.length - liveHits.length;
    liveTotals.settled += run.state.words.length; liveTotals.cursor += run.state.cursor; liveTotals.words += run.total; liveTotals.asks += run.asks;
    liveNote = `\n    live: marked ${liveHits.length}/${Object.keys(c.expected).length}${liveMarks.length > liveHits.length ? `, wrongly ${liveMarks.filter((w) => !(w.index in c.expected)).map((w) => `${w.word}←${w.heard ?? "∅"}`).join(", ")}` : ""}; settled ${run.state.words.length}/${run.total} words, cursor ${run.state.cursor}, ${run.asks} transcripts over ${run.duration.toFixed(0)}s`;
  }
  if (dump) dumped.push({ name: c.name, expected: c.expected, matched: hearing.matched, added: hearing.added, modes, prosody, words: words.filter((w) => w.verdict !== "correct").map((w) => ({ i: w.index, word: w.word, verdict: w.verdict, heard: w.heard })) });
  const show = (list: typeof words) => list.map((w) => `${w.word}:${w.verdict}${w.heard ? `←${w.heard}` : ""}`).join(", ");
  console.log(`${c.name.padEnd(48)} caught ${hits.filter(([i]) => marked(words[Number(i)].verdict)).length}/${Object.keys(c.expected).length}  false flags ${flagged.length}${flagged.length ? ` (${show(flagged)})` : ""}${doubted.length ? `  unclear ${doubted.length} (${show(doubted)})` : ""}  read ${(hearing.matched * 100).toFixed(0)}%${modes.length > 1 ? "  2 passes" : ""}  ${typeof prosody === "string" ? `prosody: ${prosody}` : `pace ${prosody.pace}`}  ${((Date.now() - started) / 1000).toFixed(1)}s${liveNote}`);
}
if (dump) writeFileSync(dump, JSON.stringify(dumped));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
console.log(`\nPlanted mistakes caught: ${sure}/${planted} (${pct(sure, planted)}); marked unclear instead: ${caught - sure}; missed: ${planted - caught}; right kind: ${pct(rightKind, planted)}`);
console.log(`Untouched words wrongly flagged: ${falseFlags}/${cleanWords} (${pct(falseFlags, cleanWords)}); untouched words marked unclear (not counted): ${cleanUnsure} (${pct(cleanUnsure, cleanWords)}); readings that needed a second transcript: ${secondPasses}/${cases.length}`);
if (liveMode) console.log(`Live coach, by the end of each take: marked ${liveTotals.caught}/${liveTotals.planted} planted mistakes (${pct(liveTotals.caught, liveTotals.planted)}); wrongly marked ${liveTotals.flags} words (${pct(liveTotals.flags, liveTotals.words)}); settled ${pct(liveTotals.settled, liveTotals.words)} of the words, cursor at ${pct(liveTotals.cursor, liveTotals.words)}; ${liveTotals.asks} transcripts`);
const pass = planted > 0 && sure / planted >= 0.8 && falseFlags / cleanWords < 0.03;
console.log(pass ? "PASS: the judge meets the Phase 0 bar." : "FAIL: below the Phase 0 bar (≥ 80% caught, < 3% false flags).");
process.exit(pass ? 0 : 2);
