#!/usr/bin/env node
/**
 * Keeps the diagram pages (docs/readaloud-bpmn.html, docs/readaloud-sequence.html)
 * in step with the code they describe.
 *
 *   node apps/web/scripts/diagrams.mjs stale [range]  list diagrams whose code changed in a git range
 *
 * A page cites code by how a line starts, never by its number. SRC + "engine/engine.ts#private ensureChunk("
 * is the one line in engine.ts that starts with "private ensureChunk(". When several lines start
 * the same way, name a line above it first: "lib/db.ts#async put( … notifyLibrary();" is the
 * first line after `async put(` that starts with "notifyLibrary();". The app works out the
 * numbers each time it serves or builds the pages (apps/web/vite.docs.ts), so readers see and
 * copy "apps/web/src/engine/engine.ts:447", and moving code never means editing a page.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PAGES = ["docs/readaloud-bpmn.html", "docs/readaloud-sequence.html"];
const SRC = "apps/web/src/";
// The spellings used on the pages: SRC + "engine/engine.ts#…", "apps/web/vite.prepare.ts#…", "packages/practice/src/pcm.ts#…" and "compose.yaml#…".
const REF = /(SRC \+ "|"(?=apps\/|packages\/|compose\.yaml#))([\w./-]+)#((?:[^"\\\n]|\\.)+)"/g;

const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

/** The line number `anchor` names in `lines`, or what is wrong with it and how to fix it. */
function lineOf(lines, anchor) {
  const [first, ...after] = anchor.split("…").map((part) => part.trim());
  const starts = lines.flatMap((line, i) => (line.trim().startsWith(first) ? [i] : []));
  if (!starts.length) return { problem: `no line starts with “${first}”. Change the text after # to the start of the line this describes.` };
  if (starts.length > 1) return { problem: `${starts.length} lines start with “${first}”. Make it longer, or name a line above it first: “<line above> … ${first}”.` };
  let at = starts[0];
  for (const part of after) {
    const next = lines.findIndex((line, i) => i > at && line.trim().startsWith(part));
    if (next < 0) return { problem: `no line below line ${at + 1} starts with “${part}”. Change the text after # to the start of the line this describes.` };
    at = next;
  }
  return { line: at + 1 };
}

/** `html` with every code reference turned into "file:line", and the references that name no line. */
export function pinRefs(html, root = ROOT) {
  const files = new Map();
  const problems = [];
  let count = 0;
  const pinned = html.replace(REF, (whole, open, path, quoted) => {
    count++;
    const file = (open === '"' ? "" : SRC) + path;
    const anchor = JSON.parse(`"${quoted}"`);
    if (!files.has(file)) files.set(file, existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), "utf8").split("\n") : null);
    const lines = files.get(file);
    const { line, problem } = lines ? lineOf(lines, anchor) : { problem: "the file no longer exists. Point the reference at the file that has this code now." };
    if (problem) {
      problems.push(`${file}#${anchor}: ${problem}`);
      return whole;
    }
    return `${open}${path}:${line}"`;
  });
  return { html: pinned, problems, count };
}

/** Load a page's model script (<script id="core">) the way the tests and the CLI need it. */
export function loadModel(page) {
  const core = read(page).match(/<script id="core">([\s\S]*?)<\/script>/)?.[1];
  if (!core) throw new Error(`${page} has no <script id="core">`);
  const module = { exports: {} };
  vm.runInNewContext(core, { module, console });
  return module.exports;
}

/** Every file a diagram tab cites, by page and tab title. */
export function filesByDiagram() {
  const out = [];
  const collect = (value, files, seen = new Set()) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value.code)) for (const c of value.code) files.add(String(c).replace(/#.*/s, ""));
    for (const [k, v] of Object.entries(value)) if (k !== "ctx") collect(v, files, seen);
  };
  const bpmn = loadModel(PAGES[0]);
  for (const [id, D] of Object.entries(bpmn.DIAGRAMS)) {
    const files = new Set();
    collect(D, files);
    out.push({ page: PAGES[0], id, title: D.title, files });
  }
  const seq = loadModel(PAGES[1]);
  for (const [id, D] of Object.entries(seq.SEQS)) {
    const files = new Set();
    collect(D, files);
    for (const m of seq.messages(id)) for (const p of [m.f, m.to]) collect(seq.P[p], files);
    out.push({ page: PAGES[1], id, title: D.title, files });
  }
  return out;
}

/**
 * Whether a page diff changes what the page says. A reference moved to another line of the
 * same file doesn't count: following code that was renamed mustn't silence the reminder.
 */
export function describesChange(diff) {
  const blank = (line) => line.replace(REF, (whole, open, path) => `${open}${path}#"`);
  const removed = new Map();
  const added = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-")) removed.set(blank(line.slice(1)), (removed.get(blank(line.slice(1))) ?? 0) + 1);
    else if (line.startsWith("+")) added.push(blank(line.slice(1)));
  }
  for (const line of added) {
    const n = removed.get(line);
    if (!n) return true;
    removed.set(line, n - 1);
  }
  return [...removed.values()].some((n) => n > 0);
}

/** Diagrams whose cited files changed in `range` while neither page's text did. */
export function staleDiagrams(range) {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  const changed = git("diff", "--name-only", range).split("\n").filter(Boolean);
  if (PAGES.some((page) => changed.includes(page) && describesChange(git("diff", "-U0", range, "--", page)))) return [];
  return filesByDiagram()
    .map((d) => ({ ...d, changed: changed.filter((f) => d.files.has(f)) }))
    .filter((d) => d.changed.length);
}

function main([command, arg]) {
  if (command === "stale") {
    const range = arg || "main...HEAD";
    const stale = staleDiagrams(range);
    if (!stale.length) { console.log(`Diagrams: nothing they cite changed in ${range}.`); return; }
    // The BPMN and sequence pages share tab titles; report each topic once.
    const byTitle = new Map();
    for (const d of stale) byTitle.set(d.title, new Set([...(byTitle.get(d.title) ?? []), ...d.changed]));
    console.log(`Diagrams that may need review (code they cite changed in ${range}; the pages didn’t):`);
    for (const [title, files] of [...byTitle].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${title}: ${[...files].map((f) => f.split("/").pop()).join(", ")}`);
    console.log(`Pages: ${PAGES.join(", ")}. A reminder only — update them if the behaviour they describe changed.`);
  } else {
    console.log("Usage: diagrams.mjs stale [git range, default main...HEAD]");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
