import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * The server writes files only through writePrivate. Seven modules each wrote beside the file
 * and renamed over it by hand, and the eighth copy (661574c, vite.transcribe.ts) dropped the
 * 0o600 mode and the 0o700 folder, so saved transcripts were readable by any user on the host.
 */

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = new Set(["vite.files.ts"]);
const FS = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const WRITES = new Set(["writeFile", "writeFileSync", "appendFile", "appendFileSync", "rename", "renameSync", "copyFile", "copyFileSync", "createWriteStream"]);
const FIX = "Use writePrivate(path, data) from ./vite.files: it writes the whole file or none, readable only by this server's user (see 661574c).";

/** Each file write that `text` imports from node:fs, or reaches through an fs namespace, by line. */
export function rawWrites(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node, write: string) => `${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}:${write}`;
  const namespaces = new Set<string>();
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !FS.has(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause?.name) namespaces.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const write = (element.propertyName ?? element.name).text;
        if (WRITES.has(write)) found.push(at(element, write));
      }
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && WRITES.has(node.name.text)) {
      const target = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "promises" ? node.expression.expression : node.expression;
      if (ts.isIdentifier(target) && namespaces.has(target.text)) found.push(at(node, node.name.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("raw file writes", () => {
  it("are not made by the server outside writePrivate", () => {
    const problems = readdirSync(WEB)
      .filter((file) => /^vite\..*\.ts$/.test(file) && !file.endsWith(".test.ts") && !ALLOWED.has(file))
      .flatMap((file) => rawWrites(file, readFileSync(join(WEB, file), "utf8")).map((found) => {
        const [line, write] = found.split(":");
        return `apps/web/${file}:${line} uses ${write}. ${FIX}`;
      }));
    expect(problems).toEqual([]);
  });

  it("finds a write however it is imported, and nothing else", () => {
    const text = [
      `import { readFile, writeFile } from "node:fs/promises";`,
      `import { rename as move } from "fs/promises";`,
      `import * as fs from "node:fs";`,
      `import fsp from "node:fs/promises";`,
      `fs.writeFileSync("a", "b"); fs.promises.appendFile("a", "b"); void fsp.copyFile("a", "b");`,
      `import { createReadStream, mkdir } from "node:fs";`,
      `store.writeFile("a"); const rename = (a: string) => a; fs.readFileSync("a");`,
    ].join("\n");
    expect(rawWrites("snippet.ts", text)).toEqual(["1:writeFile", "2:rename", "5:writeFileSync", "5:appendFile", "5:copyFile"]);
  });
});
