import { describe, expect, it } from "vitest";
import { docPages, servedDoc } from "./vite.docs";
import { DOC_LINKS } from "./src/lib/docs";

describe("hosted docs", () => {
  it("serves every page Settings links to", () => {
    const pages = docPages();
    for (const d of DOC_LINKS) expect(pages).toContain(d.page);
  });

  it("adds one link back to Settings, right after <body>, and room for it at the top", () => {
    const html = servedDoc(`<html><head><title>x</title></head><body class="a">\n<h1>Doc</h1></body></html>`, "plan.html");
    expect(html.match(/data-docs-back/g)).toHaveLength(1);
    expect(html).toMatch(/<body class="a">\n<a href="\/settings" data-docs-back/);
    expect(html).toMatch(/<style data-docs-strip>[^<]*<\/style>\n<\/head>/);
    expect(html).not.toContain("data-docs-theme");
  });

  it("gives pages drawn for T3's viewer the dark background they expect", () => {
    const html = servedDoc(`<head><style>.p{color:var(--foreground, #ece6dc)}</style></head><body>`, "design/voice-avatars.html");
    expect(html).toContain("<style data-docs-theme>html{background:#161412");
  });

  it("points links to files the app doesn't serve at the repo, resolved from the page's folder", () => {
    const html = servedDoc(
      `<body><a href="../../README.md">readme</a> <a href="../voicestudio-studio.md">notes</a> <a href="../readaloud-bpmn.html">bpmn</a> <a href="https://example.com/x.md">ext</a> <a href="#top">top</a>`,
      "plans/voicestudio-integration.html",
    );
    expect(html).toContain(`href="https://github.com/andysolomon/arc-reader/blob/main/README.md" target="_blank"`);
    expect(html).toContain(`href="https://github.com/andysolomon/arc-reader/blob/main/docs/voicestudio-studio.md" target="_blank"`);
    expect(html).toContain(`href="../readaloud-bpmn.html"`);
    expect(html).toContain(`href="https://example.com/x.md"`);
    expect(html).toContain(`href="#top"`);
  });

  it("leaves a link that climbs out of the repo alone", () => {
    expect(servedDoc(`<body><a href="../../x.md">x</a>`, "a.html")).toContain(`href="../../x.md"`);
  });
});
