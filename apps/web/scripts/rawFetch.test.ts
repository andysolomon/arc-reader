import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * Client code never calls fetch itself. A request with no deadline hangs forever on a phone that
 * sleeps or a tunnel that stalls, and that was fixed one call at a time (b4f6a00, 179a031) while
 * the next call went in without one. request() makes the deadline a required argument.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCES = ["apps/web/src", "apps/cadence/src", ...readdirSync(join(ROOT, "packages")).map((name) => `packages/${name}/src`)];
/** The only files allowed to call fetch, each with the reason. */
const ALLOWED: Record<string, string> = {
  "packages/practice/src/request.ts": "request() itself",
};
const GLOBALS = new Set(["globalThis", "window", "self"]);
const FIX = "Use request(url, { timeoutMs }) from @readaloud/practice/request: a raw fetch can hang forever on a phone that sleeps or a tunnel that stalls (see 179a031).";

/** Lines where `text` calls the global fetch or hands it on as a value. */
export function rawFetches(name: string, text: string): number[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "fetch") {
      const parent = node.parent;
      const named = (parent as { name?: ts.Node }).name === node;
      const global = ts.isPropertyAccessExpression(parent) && ts.isIdentifier(parent.expression) && GLOBALS.has(parent.expression.text);
      if ((!named || global) && !ts.isTypeQueryNode(parent)) lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

function sourceFiles(dir: string): string[] {
  return (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$|\.d\.ts$/.test(file))
    .map((file) => `${dir}/${file}`);
}

describe("raw fetch", () => {
  it("is not called from client code", () => {
    const problems = SOURCES.flatMap(sourceFiles).filter((file) => !(file in ALLOWED))
      .flatMap((file) => rawFetches(file, readFileSync(join(ROOT, file), "utf8")).map((line) => `${file}:${line} calls fetch. ${FIX}`));
    expect(problems).toEqual([]);
  });

  it("finds fetch however it is reached, and nothing else", () => {
    const text = [
      `const a = await fetch("/api/x");`,
      `void globalThis.fetch("/api/x");`,
      `export function probe(load: typeof fetch = fetch) {}`,
      `const b = await request("/api/x", { timeoutMs: 1000 });`,
      `prefetch(band); store.fetch(); const c = { fetch: 1 };`,
      `// fetch("/api/x") in a comment, and "fetch(" in a string`,
    ].join("\n");
    expect(rawFetches("snippet.ts", text)).toEqual([1, 2, 3]);
  });
});
