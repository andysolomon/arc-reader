#!/usr/bin/env node
/**
 * Keeps the diagram pages (docs/readaloud-bpmn.html, docs/readaloud-sequence.html)
 * in step with the code they describe.
 *
 *   node apps/web/scripts/diagrams.mjs refs           re-point code references at their lines
 *   node apps/web/scripts/diagrams.mjs refs --check   only report; exit 1 if a reference is broken
 *   node apps/web/scripts/diagrams.mjs stale [range]  list diagrams whose code changed in a git range
 *
 * Each code reference on the pages ("apps/web/src/engine/engine.ts:443") has an
 * anchor in docs/diagram-anchors.json: the text of the line it was written
 * against. When code moves, `refs` finds that line again and rewrites the
 * number. A new reference is pinned to whatever line it points at the first
 * time `refs` runs. A reference is broken when its anchor can no longer be
 * found; then a person has to look at what the diagram says.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PAGES = ["docs/readaloud-bpmn.html", "docs/readaloud-sequence.html"];
const ANCHORS = "docs/diagram-anchors.json";
const SRC = "apps/web/src/";
// Both spellings used on the pages: SRC + "engine/engine.ts:443" and "apps/web/vite.prepare.ts:240".
const REF = /SRC \+ "([^"]+?):(\d+)"|"((?:apps\/web\/|compose\.yaml)[^"]*?):(\d+)"/g;

const read = (path) => readFileSync(resolve(ROOT, path), "utf8");
const fileLines = new Map();
function linesOf(path) {
  if (!fileLines.has(path)) fileLines.set(path, existsSync(resolve(ROOT, path)) ? read(path).split("\n") : null);
  return fileLines.get(path);
}

/** A line that says nothing on its own: blank, punctuation, or a comment marker. */
const weak = (text) => /^[\s{}()[\];,]*$/.test(text) || /^(\/\/|\/\*|\*\/?|#)\s*$/.test(text);

/**
 * The line an anchor now lives on, nearest the old number when it appears more than once.
 * A declaration whose parameters or value changed still matches on its name
 * ("private ensureChunk(" keeps matching after its signature changes).
 */
function locate(lines, anchor, near) {
  const nearest = (hits) => hits.length ? hits.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a)) : null;
  const exact = [];
  lines.forEach((line, i) => { if (line.trim() === anchor) exact.push(i + 1); });
  if (exact.length) return nearest(exact);
  const head = anchor.match(/^(.*?[A-Za-z_$][\w$]*)\s*[(=:<]/)?.[1];
  if (!head || head.length < 10) return null;
  const prefixed = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith(head) && !/[\w$]/.test(t[head.length] ?? "")) prefixed.push(i + 1);
  });
  return nearest(prefixed);
}

/** Re-point every reference. Returns the rewritten pages and anchors without writing them. */
export function resolveRefs() {
  const anchors = existsSync(resolve(ROOT, ANCHORS)) ? JSON.parse(read(ANCHORS)) : {};
  const next = {}, problems = [], moved = [], pages = {};
  let count = 0;
  for (const page of PAGES) {
    pages[page] = read(page).replace(REF, (whole, srcPath, srcLine, path, line) => {
      count++;
      const file = srcPath ? SRC + srcPath : path;
      const n = Number(srcLine ?? line);
      const key = `${file}:${n}`;
      const lines = linesOf(file);
      if (!lines) { problems.push(`${page}: ${key} — the file no longer exists`); return whole; }
      const anchor = anchors[key] ?? (n <= lines.length ? lines[n - 1].trim() : undefined);
      const found = anchor === undefined ? null : locate(lines, anchor, n);
      if (found === null) {
        problems.push(`${page}: ${key} — can’t find “${anchor ?? `line ${n}`}” any more`);
        if (anchor !== undefined) next[key] = anchor;
        return whole;
      }
      if (weak(lines[found - 1].trim())) problems.push(`${page}: ${file}:${found} points at a line with no code on it`);
      if (found !== n) moved.push(`${key} → ${found}`);
      next[`${file}:${found}`] = anchor;
      return srcPath ? `SRC + "${srcPath}:${found}"` : `"${path}:${found}"`;
    });
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  return { pages, anchors: sorted, problems, moved: [...new Set(moved)], count };
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
    if (Array.isArray(value.code)) for (const c of value.code) files.add(String(c).replace(/:\d+$/, ""));
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

/** Diagrams whose cited files changed in `range` while neither page did. */
export function staleDiagrams(range) {
  const changed = execFileSync("git", ["diff", "--name-only", range], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  if (changed.some((f) => PAGES.includes(f))) return [];
  return filesByDiagram()
    .map((d) => ({ ...d, changed: changed.filter((f) => d.files.has(f)) }))
    .filter((d) => d.changed.length);
}

function main([command, arg]) {
  if (command === "refs") {
    const { pages, anchors, problems, moved, count } = resolveRefs();
    if (arg !== "--check") {
      for (const [page, html] of Object.entries(pages)) if (html !== read(page)) writeFileSync(resolve(ROOT, page), html);
      const json = JSON.stringify(anchors, null, 1) + "\n";
      if (!existsSync(resolve(ROOT, ANCHORS)) || json !== read(ANCHORS)) writeFileSync(resolve(ROOT, ANCHORS), json);
    }
    console.log(`${count} code references, ${moved.length} ${arg === "--check" ? "out of date" : "re-pointed"}${problems.length ? `, ${problems.length} broken` : ""}.`);
    for (const p of problems) console.log("  " + p);
    if (problems.length) console.log("Fix these on the pages: point each reference at the code it describes, then run this again.");
    process.exitCode = problems.length ? 1 : 0;
  } else if (command === "stale") {
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
    console.log("Usage: diagrams.mjs refs [--check] | stale [git range, default main...HEAD]");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
