import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import "./CodeBlock.css";

type Hljs = typeof import("highlight.js/lib/common").default;
let loading: Promise<Hljs> | undefined;
const loadHljs = () => (loading ??= import("highlight.js/lib/common").then((m) => m.default));

/** highlight.js output is escaped HTML; unknown or missing languages are guessed. */
function highlight(hljs: Hljs, text: string, language: string): string {
  const lang = language.toLowerCase();
  return hljs.getLanguage(lang)
    ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
    : hljs.highlightAuto(text).value;
}

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Splits highlighted HTML at newlines, closing spans that are open at a line's end and
 * reopening them on the next, so each source line can be its own block.
 */
function splitLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = "";
  for (const [tok] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+|</g)) {
    if (tok === "\n") {
      lines.push(line + "</span>".repeat(open.length));
      line = open.join("");
    } else {
      if (tok.startsWith("<span")) open.push(tok);
      else if (tok === "</span>") open.pop();
      line += tok;
    }
  }
  lines.push(line);
  return lines;
}

/** Leading whitespace in columns (tabs count as two, matching tab-size). */
const indentOf = (line: string) => {
  const ws = line.match(/^[ \t]*/)![0];
  return ws.length + (ws.split("\t").length - 1);
};

export interface CodeBlockProps {
  text: string;
  language: string;
  /** Highlighting loads on first show, so closed cards cost nothing. */
  visible?: boolean;
  className?: string;
}

/**
 * Original source, wrapped to the card's width (no sideways scrolling) and syntax
 * highlighted with theme-aware colours from CodeBlock.css. Plain text shows until the
 * highlighter has loaded.
 */
export function CodeBlock({ text, language, visible = true, className }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setHtml(null);
    loadHljs()
      .then((hljs) => { if (live) setHtml(highlight(hljs, text, language)); })
      .catch(() => {});
    return () => { live = false; };
  }, [visible, text, language]);

  // Wrapped lines hang two columns past their own indent, so a continuation never
  // reads as a new statement.
  const lines = useMemo(() => {
    const indents = text.split("\n").map((l) => Math.min(indentOf(l), 24) + 2);
    return splitLines(html ?? escape(text)).map((h, i) => ({ html: h, hang: indents[i] ?? 2 }));
  }, [html, text]);

  return (
    <pre
      className={cn(
        "code-hl m-0 max-h-96 overflow-y-auto overflow-x-hidden whitespace-pre-wrap font-mono text-[12px] leading-6 [font-variant-ligatures:none] [overflow-wrap:anywhere] [tab-size:2]",
        className,
      )}
      tabIndex={0}
      aria-label="Original code"
    >
      <code>
        {lines.map((l, i) => (
          <span
            key={i}
            className="block min-h-6"
            style={{ paddingLeft: `${l.hang}ch`, textIndent: `-${l.hang}ch` }}
            dangerouslySetInnerHTML={{ __html: l.html }}
          />
        ))}
      </code>
    </pre>
  );
}
