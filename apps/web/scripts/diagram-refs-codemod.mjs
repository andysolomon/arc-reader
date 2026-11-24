#!/usr/bin/env node
/**
 * One-shot: rewrites the diagram pages' line-number references (SRC + "engine/engine.ts:447")
 * as anchors (SRC + "engine/engine.ts#private ensureChunk("), then checks that the pages are
 * served exactly as before, byte for byte. Run from anywhere; a second run finds nothing to do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGES, ROOT, pinRefs } from "./diagrams.mjs";

const SRC = "apps/web/src/";
const OLD = /SRC \+ "([^"]+?):(\d+)"|"((?:apps\/web\/|packages\/|compose\.yaml)[^"]*?):(\d+)"/g;
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

/** The line `anchor` names in `file` now, through the same code that serves the pages. */
function lineNamed(file, anchor) {
  const { html, problems } = pinRefs(JSON.stringify(`${file}#${anchor}`));
  return problems.length ? null : Number(html.match(/:(\d+)"$/)[1]);
}

const KEYWORDS = new Set("export default async function const let var class private protected public static readonly get set return await new if for while else type interface enum import from declare abstract override typeof of in as".split(" "));

/**
 * Starts of `text` that end after a name (and the bracket that opens its arguments), shortest
 * first. "export async" names nothing, so a start never ends on a keyword; a comment gets four words.
 */
function starts(text) {
  const cuts = [];
  for (let p = 1; p <= text.length; p++) {
    if (!/[\w$]/.test(text[p - 1]) || /[\w$]/.test(text[p] ?? "")) continue;
    const cut = text.slice(0, text[p] === "(" ? p + 1 : p);
    const words = cut.match(/[\w$]+/g);
    if (cut.length < 8 || KEYWORDS.has(words.at(-1)) || (/^(\*|\/\/|\/\*|#)/.test(text) && words.length < 4)) continue;
    cuts.push(cut);
  }
  return [...cuts, text];
}

/**
 * The shortest anchor that names line `n`. A shared line is named in full when it is short,
 * under the nearest enclosing line that works, else under the nearest named line above.
 */
function anchorFor(file, n) {
  const lines = read(file).split("\n");
  const text = lines[n - 1].trim();
  const own = starts(text).find((cut) => lineNamed(file, cut) === n);
  if (own) return own;
  const indent = (line) => line.match(/^\s*/)[0].length;
  const above = [...lines.keys()].slice(0, n - 1).reverse().filter((i) => /[A-Za-z_$]{3}/.test(lines[i]));
  const inners = text.length <= 48 ? [text, ...starts(text)] : starts(text);
  for (const i of [...above.filter((i) => indent(lines[i]) < indent(lines[n - 1])), ...above]) {
    const scope = starts(lines[i].trim()).find((cut) => /[A-Za-z_$]{3}/.test(cut) && lineNamed(file, cut) === i + 1);
    const inner = scope && inners.find((cut) => lineNamed(file, `${scope} … ${cut}`) === n);
    if (inner) return `${scope} … ${inner}`;
  }
  throw new Error(`${file}:${n}: no anchor names “${text}”`);
}

let rewritten = 0;
for (const page of PAGES) {
  const before = read(page);
  const after = before.replace(OLD, (whole, srcPath, srcLine, path, line) => {
    rewritten++;
    const anchor = anchorFor(srcPath ? SRC + srcPath : path, Number(srcLine ?? line));
    return srcPath ? `SRC + ${JSON.stringify(`${srcPath}#${anchor}`)}` : JSON.stringify(`${path}#${anchor}`);
  });
  const { html, problems } = pinRefs(after);
  if (problems.length || html !== pinRefs(before).html) throw new Error(`${page}: the anchors don’t pin back to the same lines\n${problems.join("\n")}`);
  if (after !== before) writeFileSync(resolve(ROOT, page), after);
}
console.log(`${rewritten} references rewritten as anchors; pinning them gives back the pages as they were.`);
