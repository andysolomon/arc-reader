import { describe, it, expect } from "vitest";
import { readingBlocks, codeKey, safeCodeSummary } from "./codeBlocks";
import { segment, planPassages } from "./segment";

const code = 'const result = items.filter(item => item.active);\nconsole.log(result);';

describe("code narration", () => {
  it.each(["```", "~~~~", "````"])("keeps %s fenced code together, with surrounding prose and internal blank lines", (fence) => {
    const text = `Before.\n${fence}javascript\n${code}\n\n// A comment. Still code.\n${fence}\nAfter.`;
    const result = segment(text);
    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs[1].code).toEqual({ text: `${code}\n\n// A comment. Still code.`, language: "javascript", summarized: false });
    const spoken = planPassages(result.sentences).map((p) => p.text).join(" ");
    expect(spoken).toContain("Before.");
    expect(spoken).toContain("skip the code");
    expect(spoken).toContain("After.");
    expect(spoken).not.toContain("console");
    expect(spoken).not.toContain("comment");
  });

  it("uses one seek target per explanation and ignores summaries for edited code", () => {
    const text = `Intro.\n\n\`\`\`js\n${code}\n\`\`\`\n\nNext. Last.`;
    const key = codeKey({ language: "js", text: code });
    const summaries = { [key]: "This example selects active items. It prints the result." };
    const result = segment(text, summaries);
    expect(result.sentences.map((s) => s.text)).toEqual(["Intro.", summaries[key], "Next.", "Last."]);
    expect(result.paragraphs.map((p) => p.start)).toEqual([0, 1, 2]);
    expect(result.paragraphs[1].code?.summarized).toBe(true);
    expect(segment(text.replace("item.active", "item.enabled"), summaries).sentences[1].text).toContain("skip the code");
  });

  it("protects unclosed fences and does not close a four-backtick fence with three", () => {
    expect(segment('Intro.\n````js\nconst x = 1;\n```\nsecret();').paragraphs[1].code?.text).toContain("secret();");
    expect(segment('```python\nprint("hello")').sentences[0].text).not.toContain("print");
  });

  it("recognizes indented and obvious unfenced snippets", () => {
    for (const text of ["Before.\n\n    def hello():\n        print('hello')\n\nAfter.", `Before.\n${code}\nAfter.`]) {
      expect(readingBlocks(text).map((b) => b.kind)).toEqual(["prose", "code", "prose"]);
      expect(segment(text).sentences.map((s) => s.text).join(" ")).not.toMatch(/print|console/);
    }
  });

  it("preserves ordinary prose and inline identifiers", () => {
    const text = "Use `filter` to keep active items.\nfrom this example we learn something.\n\nA final paragraph.";
    expect(readingBlocks(text)).toEqual([{ kind: "prose", text }]);
    expect(segment(text).sentences).toHaveLength(3);
  });

  it.each(["```js\nconsole.log(1)\n```", "const x = 1", "Use this:\nprint(1)", "function test() {}", "x ".repeat(101), ""])("rejects unsafe or oversized explanations: %s", (value) => {
    expect(safeCodeSummary(value)).toBe(false);
  });
});
