import { describe, expect, it } from "vitest";
import { docPages, servedDoc } from "./vite.docs";
import { DOC_LINKS } from "./src/lib/docs";

describe("hosted docs", () => {
  it("serves every page Settings links to", () => {
    const pages = docPages();
    for (const d of DOC_LINKS) expect(pages).toContain(d.page);
  });

  it("adds one bar, right after <body>, with a link back to the Settings section and room for it at the top", () => {
    const html = servedDoc(`<html><head><title>x</title></head><body class="a">\n<h1>Doc</h1></body></html>`, "plan.html");
    expect(html.match(/<nav data-docs-bar/g)).toHaveLength(1);
    expect(html).toMatch(/<body class="a">\n<nav data-docs-bar [^>]*><a href="\/settings#how-it-works" data-docs-back>/);
    expect(html).toMatch(/<style data-docs-strip>[^<]*<\/style>\n<\/head>/);
    expect(html).toContain("html{box-sizing:border-box;padding-top:var(--docs-bar) !important");
    expect(html).not.toContain("data-docs-theme");
  });

  it("names the page in the bar and lists the others, to move between them without going back", () => {
    const html = servedDoc(`<head><title>Sequences</title></head><body>`, "readaloud-sequence.html");
    expect(html).toContain("<label data-docs-title><span>Sequence diagrams</span>");
    expect(html.match(/<option /g)).toHaveLength(DOC_LINKS.length);
    expect(html).toContain(`<option value="/docs/readaloud-sequence.html" selected>Sequence diagrams</option>`);
    expect(html).toContain(`<option value="/docs/readaloud-bpmn.html">Process diagrams</option>`);
  });

  it("names a page Settings doesn't list by its own title, and offers the listed ones", () => {
    const html = servedDoc(`<head><title>Reading &amp; Practice — system design</title></head><body>`, "plans/reading-practice.html");
    expect(html).toContain("<label data-docs-title><span>Reading &amp; Practice</span>");
    expect(html).toContain(`<option value="/docs/plans/reading-practice.html" selected>Reading &amp; Practice</option>`);
    expect(html.match(/<option /g)).toHaveLength(DOC_LINKS.length + 1);
  });

  it("lets the page reach under the notch and the home indicator, so the safe areas are reported", () => {
    const meta = (html: string) => /<meta name="viewport" content="([^"]*)"/.exec(servedDoc(html, "a.html"))?.[1];
    expect(meta(`<head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>`)).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
    expect(meta(`<head><meta name="viewport" content="width=device-width,viewport-fit=cover"></head><body>`)).toBe("width=device-width,viewport-fit=cover");
  });

  it("gives pages drawn for T3's viewer the dark background they expect", () => {
    const html = servedDoc(`<head><style>.p{color:var(--foreground, #ece6dc)}</style></head><body>`, "design/voice-avatars.html");
    expect(html).toMatch(/<style data-docs-theme>[^<]*html\{background:#161412/);
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
