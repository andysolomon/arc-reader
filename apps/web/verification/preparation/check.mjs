#!/usr/bin/env node
// Model-checks the audio preparation queue with TLC. The current code must pass every
// property, each fixed bug switched back on must break the property that guards it, and
// a known finding must keep failing until the code changes.
//   node apps/web/verification/preparation/check.mjs [CONFIG ...]
// Needs Java 11 or later (JAVA, or java on PATH). Downloads the pinned tla2tools.jar once
// into TLA2TOOLS_CACHE (default ~/.cache/readaloud), or uses TLA2TOOLS when set.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.7.4";
const SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const here = dirname(fileURLToPath(import.meta.url));

/**
 * What TLC must report for each config: "pass", or the one property it must break.
 * A finding is a break on the current code; `fixed` says what to do once it stops breaking.
 */
const RUNS = [
  { config: "PreparationQueue.cfg", expect: "pass" },
  { config: "PreparationQueue.179a031.cfg", expect: "PlacesComeBack" },
  { config: "PreparationQueue.86d7c09-resend.cfg", expect: "NoResendAfterReload" },
  { config: "PreparationQueue.86d7c09-rewalk.cfg", expect: "NoRewalk" },
  { config: "PreparationQueue.starvation.cfg", expect: "QueuedReachServer", fixed: "Add QueuedReachServer to PreparationQueue.cfg and delete PreparationQueue.starvation.cfg." },
  { config: "SharedPreparations.cfg", expect: "pass" },
  { config: "SharedPreparations.847a4bc.cfg", expect: "ClearedStayCleared" },
  { config: "SharedPreparations.text-changes.cfg", expect: "ClearedStayCleared", fixed: "Set TextChanges = TRUE in SharedPreparations.cfg and delete SharedPreparations.text-changes.cfg." },
];

async function tla2tools() {
  if (process.env.TLA2TOOLS) return process.env.TLA2TOOLS;
  const dir = join(process.env.TLA2TOOLS_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "readaloud"), `tla2tools-${VERSION}`);
  const jar = join(dir, "tla2tools.jar");
  if (existsSync(jar)) return jar;
  const response = await fetch(`https://github.com/tlaplus/tlaplus/releases/download/v${VERSION}/tla2tools.jar`);
  if (!response.ok) throw new Error(`Could not download tla2tools.jar (HTTP ${response.status}).`);
  const body = Buffer.from(await response.arrayBuffer());
  const sum = createHash("sha256").update(body).digest("hex");
  if (sum !== SHA256) throw new Error(`tla2tools.jar checksum ${sum} does not match ${SHA256}.`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(jar, body);
  return jar;
}

const KEYWORDS = /^(SPECIFICATION|INIT|NEXT|CONSTANTS?|INVARIANTS?|PROPERTY|PROPERTIES|CONSTRAINTS?|ACTION_CONSTRAINTS?|SYMMETRY|VIEW|CHECK_DEADLOCK|ALIAS|POSTCONDITION)$/;
/** The invariants and properties a config asks TLC to check, by name. */
function checked(config) {
  const words = readFileSync(join(here, config), "utf8").replace(/\\\*.*$/gm, "").split(/\s+/).filter(Boolean);
  let section = "";
  return words.filter((word) => KEYWORDS.test(word) ? (section = word, false) : /^(INVARIANTS?|PROPERTY|PROPERTIES)$/.test(section));
}

/** TLC's verdict: "pass", the invariant it names, "temporal" for a property, or the error it printed. */
function verdict(output, status) {
  if (status === 0 && /Model checking completed\. No error has been found\./.test(output)) return "pass";
  const invariant = /Error: Invariant (\w+) is violated/.exec(output);
  if (invariant) return invariant[1];
  if (/Error: Temporal properties were violated\./.test(output)) return "temporal";
  return output.split("\n").find((line) => /^Error|deadlock/i.test(line)) || `TLC exited with ${status}`;
}

const jar = await tla2tools();
const java = process.env.JAVA || "java";
const only = process.argv.slice(2);
const runs = only.length ? RUNS.filter((run) => only.includes(run.config)) : RUNS;
if (!runs.length) throw new Error(`No such config. Choose from: ${RUNS.map((run) => run.config).join(", ")}`);
let failed = 0;
for (const { config, expect, fixed } of runs) {
  const spec = config.split(".")[0];
  const names = checked(config);
  if (expect !== "pass" && (names.length !== 1 || names[0] !== expect)) throw new Error(`${config} must check ${expect} alone, so a failure can only mean that property; it checks ${names.join(", ") || "nothing"}.`);
  const meta = mkdtempSync(join(tmpdir(), "tlc-"));
  const started = Date.now();
  const result = spawnSync(java, ["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", "auto", "-lncheck", "final", "-metadir", meta, "-config", config, `${spec}.tla`], { cwd: here, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  rmSync(meta, { recursive: true, force: true });
  if (result.error) throw new Error(`Could not run ${java}: ${result.error.message}`);
  const output = result.stdout + result.stderr;
  const got = verdict(output, result.status);
  const broke = got === "temporal" ? names[0] : got;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const states = /^\d+ states generated, (\d+) distinct states found/m.exec(output)?.[1] ?? "?";
  const ok = expect === "pass" ? got === "pass" : broke === expect && names.length === 1;
  const what = expect === "pass" ? "every property holds" : `${expect} fails${fixed ? " (finding on the current code)" : " (past bug replayed)"}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${config.padEnd(38)} ${ok ? what : `expected: ${what}; got: ${got}`}  [${states} states, ${seconds}s]`);
  if (!ok) {
    failed++;
    if (fixed && got === "pass") console.log(`     The finding no longer breaks the model. ${fixed}`);
    else console.log(output.split("\n").map((line) => `     ${line}`).join("\n"));
  }
}
process.exit(failed ? 1 : 0);
