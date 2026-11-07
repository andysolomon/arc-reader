import { VISUAL_FENCE, visualFrom, markdownVisuals, type ArticleVisual } from "./visuals";
import { hash } from "./hash";

export type ReadingBlock = { kind: "prose"; text: string } | { kind: "code"; text: string; language: string } | { kind: "visual"; text: string; visual: ArticleVisual };

/** Deliberately conservative for unfenced snippets: ordinary prose stays prose. */
function codeLine(line: string): boolean {
  return /^\s*(?:(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*[=:]|(?:async\s+)?function\s+[\w$]*\s*\(|(?:def|class)\s+\w+[^\n]*[:{]|import\s+[\w{*.'"]|from\s+[\w.]+\s+import\b|(?:if|for|while|switch)\s*\(|(?:return|throw)\s+.+[;}]\s*$|(?:console\.\w+|print|require)\s*\(|(?:npm|pnpm|yarn|pip|git|sudo|curl|docker)\s+|\$\s+\S|[{}\[\]]+[;,]?\s*$|["'][\w-]+["']\s*:)/.test(line)
    || /^\s*(?:[\w$]+(?:\.[\w$]+)*\s*(?:=(?!=)|:=)|[\w$.]+\([^\n]*\);?\s*$|<\/?[a-zA-Z][^>]*>|\((?:define|defun|lambda|let|set!|display)\s|(?:SELECT|INSERT INTO|CREATE TABLE|UPDATE|DELETE FROM)\s)/.test(line);
}

/** Keep code boundaries before paragraph/sentence splitting destroys them. */
export function readingBlocks(source: string, baseUrl?: string): ReadingBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReadingBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    const text = prose.join("\n").trim();
    if (text) blocks.push(...markdownVisuals(text, baseUrl));
    prose = [];
  };
  for (let i = 0; i < lines.length;) {
    const fence = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flush();
      const marker = fence[1][0];
      const close = new RegExp(`^\\s*${marker}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      if (fence[2].trim() === VISUAL_FENCE) {
        let visual: ArticleVisual | null = null;
        try { visual = visualFrom(JSON.parse(code.join("\n"))); } catch { /* Corrupt metadata is never spoken. */ }
        blocks.push({ kind: "visual", text: "", visual: visual ?? { kind: "image", src: "", alt: "", caption: "" } });
        continue;
      }
      blocks.push({ kind: "code", text: code.join("\n"), language: fence[2].trim().split(/\s/)[0].replace(/[^\w#+.-]/g, "").slice(0, 40) });
      continue;
    }
    const indented = /^(?: {4,}|\t)\S/.test(lines[i]) && (i === 0 || !lines[i - 1].trim());
    if (indented || codeLine(lines[i])) {
      flush();
      const code: string[] = [lines[i++]];
      while (i < lines.length) {
        if (/^\s*(`{3,}|~{3,})/.test(lines[i])) break;
        if (codeLine(lines[i]) || /^(?: {2,}|\t)\S/.test(lines[i]) || /^\s*(?:\/\/|\/\*|\*)/.test(lines[i])) { code.push(lines[i++]); continue; }
        if (!lines[i].trim() && i + 1 < lines.length && (codeLine(lines[i + 1]) || /^(?: {4,}|\t)\S/.test(lines[i + 1]))) {
          code.push(lines[i++]); continue;
        }
        break;
      }
      blocks.push({ kind: "code", text: code.join("\n"), language: "" });
      continue;
    }
    prose.push(lines[i++]);
  }
  flush();
  return blocks;
}

export const codeKey = (block: { text: string; language: string }) => `v1:${hash(`${block.language}\n${block.text}`)}:${block.text.length}`;
export type CodeSummaries = Record<string, string>;

/** Treat generated or synced summaries as prose only, never as another code passage. */
export function safeCodeSummary(text: unknown): text is string {
  return typeof text === "string" && !!text.trim() && text.length <= 700
    && text.trim().split(/\s+/).length <= 100
    && !/[`{};]|=>|\n/.test(text.trim())
    && readingBlocks(text).every((block) => block.kind === "prose");
}

export function codeNarration(block: Extract<ReadingBlock, { kind: "code" }>, summaries: CodeSummaries = {}): string {
  const summary = summaries[codeKey(block)];
  if (safeCodeSummary(summary)) return summary.trim();
  return "A code example appears here. Its spoken explanation is unavailable, so we’ll skip the code and continue.";
}

/** A fence long enough to preserve code that itself contains backticks. */
export function fencedCode(text: string, language = ""): string {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return `${fence}${language}\n${text}\n${fence}`;
}
