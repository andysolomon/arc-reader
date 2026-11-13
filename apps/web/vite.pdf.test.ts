// @vitest-environment jsdom
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawPages, isDeck, isPdf, pageDrawing, pageItems, pageLines, paragraphs, pdfHtml, pdfPage, pictured, readPdf, slides, type PdfDrawing, type PdfItem, type PdfPage } from "./vite.pdf";
import { SlideStore } from "./vite.slides";
import { htmlToText } from "./src/lib/fetchUrl";
import { readingBlocks } from "./src/lib/codeBlocks";
import { DECK, DIAGRAM, buildPdf } from "./tests/fixtures/pdf";

/** A run of text about as wide as its letters. */
const run = (str: string, x: number, y: number, height: number): PdfItem => ({ str, x, y, height, width: str.length * height * 0.5 });
const slide = (...items: PdfItem[]): PdfPage => ({ width: 960, height: 540, items });
const sheet = (...items: PdfItem[]): PdfPage => ({ width: 612, height: 792, items });
const bullet = (text: string, y: number, height = 28) => [run("●", 52, y, 18), run(" ", 63, y, 0), run(text, 88, y, height)];
const drawn = (page: PdfPage, drawing: Partial<PdfDrawing>): PdfPage => ({ ...page, drawing: { images: [], paths: 0, ...drawing } });
/** A picture covering `area` of the slide, at a place of its own unless told otherwise. */
const image = (area: number, at: string, id = at) => ({ area, at, id });
const picture = (page: number) => `/api/slides/${"a".repeat(32)}/${page}.jpg`;

describe("PDF text", () => {
  it("tells a PDF by its type or its first bytes", () => {
    expect(isPdf(Buffer.from("<html>"), "application/pdf")).toBe(true);
    expect(isPdf(Buffer.from("%PDF-1.7\n…"), "application/octet-stream")).toBe(true);
    expect(isPdf(Buffer.from("<!doctype html><p>About the %PDF- header</p>".padStart(2000)), "text/html")).toBe(false);
  });

  it("reads what a stretch of glyphs really spells, and leaves out sideways text", () => {
    const text = (str: string, x: number, angle = 0) => ({ str, transform: angle ? [0, 1, -1, 0, x, 300] : [1, 0, 0, 1, x, 300], width: str.length * 10, height: 20 });
    const items = pageItems([
      text("design pa", 0),
      { type: "beginMarkedContentProps", actualText: "tt" }, text("=", 90), { type: "endMarkedContent" },
      text("erns", 100),
      { type: "beginMarkedContentProps", actualText: null }, text("kept", 200), { type: "endMarkedContent" },
      text("arXiv:2407.01502v1", 20, 90),
      text("have to", 300),
      { type: "beginMarkedContentProps", actualText: "fi" }, text(" ", 370), text("\ufb01", 380), { type: "endMarkedContent" },
      text("nish", 390),
    ]);
    expect(items.map((item) => item.str)).toEqual(["design pa", "tt", "erns", "kept", "have to", " ", "fi", "nish"]);
    expect(pageLines(slide(...items.slice(4))).map((line) => line.text)).toEqual(["have to finish"]);
    expect(items[1]).toMatchObject({ x: 90, width: 10 });
    expect(pageLines(slide(...items.slice(0, 3))).map((line) => line.text)).toEqual(["design patterns"]);
  });

  it("joins the runs of a line, wrapped bullets, and keeps columns apart", () => {
    const page = slide(
      run("Why agents", 40, 451, 40),
      ...bullet("LLM people know how models are trained, prompted, aligned, and", 302), run("evaluated", 88, 271, 28),
      ...bullet("Systems people build reliable software", 241),
      run("Left column", 52, 150, 28), run("Right column", 508, 150, 28),
    );
    expect(pageLines(page).map((line) => line.text)).toEqual([
      "Why agents", "LLM people know how models are trained, prompted, aligned, and", "evaluated", "Systems people build reliable software", "Left column", "Right column",
    ]);
    expect(slides([page])[0]).toEqual({ page: 1, title: "Why agents", pictured: false, points: [
      "LLM people know how models are trained, prompted, aligned, and evaluated", "Systems people build reliable software", "Left column", "Right column",
    ] });
  });

  it("joins a wrapped bullet whose first word is drawn larger, with the bullet", () => {
    const page = slide(
      run("Recap", 99, 907, 85),
      run("• Work", 101, 777, 59), run("flows are simpler to reproduce and", 278, 782, 48), run("debug than agents", 149, 731, 48),
      run("• We covered five patterns", 101, 630, 48),
      // Here the whole first line but one ligature is reported at the bullet's size.
      run("• Agents are more adaptable/", 101, 438, 59), run("fl", 927, 443, 48), run("exible", 975, 443, 48), run("than workflows", 149, 391, 48),
      // And here all of it is.
      run("• In practice real workflows are larger", 101, 290, 59), run("compositions of the parts", 149, 243, 48),
    );
    expect(slides([page])[0].points).toEqual([
      "Workflows are simpler to reproduce and debug than agents", "We covered five patterns",
      "Agents are more adaptable/flexible than workflows", "In practice real workflows are larger compositions of the parts",
    ]);
  });

  it("leaves out the credit for a picture, wherever it sits and however it wraps", () => {
    const [recap] = slides([slide(
      run("Recap", 99, 450, 44), ...bullet("Workflows are simpler to debug than agents", 300),
      ...bullet("Data sources: logs and traces", 250),
      // Beside the footer on one line, its address wrapping onto the next.
      run("CS 329Z", 40, 80, 16), run("Image Credit: https://www.langchain.com/blog/how-to-", 100, 80, 16), run("think-about-agent-frameworks", 300, 62, 16),
      run("Table Credit: https://arxiv.org/pdf/2409.15254", 500, 40, 16), run("https://arxiv.org/", 500, 22, 16), run("Source: Anthropic", 700, 22, 16),
    )]);
    expect(recap).toMatchObject({ title: "Recap", points: ["Workflows are simpler to debug than agents", "Data sources: logs and traces", "CS 329Z"] });
  });

  it("titles each slide, drops page numbers, and keeps only the last step of a build", () => {
    const deck = [
      slide(run("CS 329Z", 177, 327, 44), run("Intro to Agentic Systems", 109, 252, 66), run("Diyi Yang", 206, 122, 36)),
      slide(run("History of Agents", 55, 397, 40), ...bullet("First indexed use in 1973", 300), run("2", 914, 20, 12)),
      slide(run("History of Agents", 55, 397, 40), ...bullet("First indexed use in 1973", 300), ...bullet("Contract Net Protocol in 1980", 250), run("3", 914, 20, 12)),
      slide(run("What is a benchmark?", 300, 270, 48)),
      slide(run("Four captions of one size.", 100, 400, 20), run("None of them is a title.", 500, 300, 20), run("They are read as points.", 100, 200, 20), run("In the order they are drawn.", 500, 100, 20)),
      slide(),
    ];
    expect(isDeck(deck)).toBe(true);
    expect(slides(deck).map((s) => [s.page, s.title, s.points.length])).toEqual([
      [1, "Intro to Agentic Systems", 2], [3, "History of Agents", 2], [4, "What is a benchmark?", 0], [5, "", 4],
    ]);
  });

  it("reads a diagram's labels once, as a list, and skips its symbols and numbers", () => {
    const labels = ["class", "was", "about", "agents", "class", "P(", "|", ") = 0.0377", "The", "0.0001"].map((word, i) => run(word, 40 + (i % 5) * 200, 300 - Math.floor(i / 5) * 60, 24));
    const [diagram] = slides([slide(run("Language Model Sampling", 50, 450, 44), ...labels, run("In practice we sum the logs of the probabilities.", 60, 60, 24))]);
    expect(diagram).toEqual({ page: 1, title: "Language Model Sampling", pictured: false, points: ["In practice we sum the logs of the probabilities.", "class, was, about, agents, The"] });
  });

  it("flows a document across lines, columns and pages, past its footnotes", () => {
    const pages = [
      sheet(
        run("AI Agents That Matter", 150, 700, 17),
        run("1 Introduction", 72, 640, 12),
        run("Compound AI systems are becoming an important research direc-", 72, 610, 10), run("tion. Many benchmarks have been released. We introduce three", 72, 598, 10),
        run("baseline agents and empirically", 72, 586, 10),
        run("Equal contribution.", 85, 80, 8),
        run("1", 300, 30, 10),
      ),
      sheet(run("show that they outperform complex agents.", 72, 720, 10), run("A second paragraph starts here.", 72, 690, 10), run("2", 300, 30, 10)),
    ];
    expect(isDeck(pages)).toBe(false);
    expect(paragraphs(pages)).toEqual([
      { text: "AI Agents That Matter", heading: 1 },
      { text: "1 Introduction", heading: 2 },
      { text: "Compound AI systems are becoming an important research direction. Many benchmarks have been released. We introduce three baseline agents and empirically show that they outperform complex agents." },
      { text: "Equal contribution." },
      { text: "A second paragraph starts here." },
    ]);
  });

  it("refuses a PDF with nothing to read", () => {
    expect(pdfHtml([slide(), slide(run("3", 914, 20, 12))], {}, "https://example.com/scan.pdf")).toBeNull();
    // A scanned deck is all pictures: describing them would not read out what the slides say.
    const scan = ["a", "b", "c"].map((at) => drawn(slide(), { images: [image(1, at)] }));
    expect(pdfHtml(scan, {}, "https://example.com/scan.pdf", picture)).toBeNull();
  });

  it("finds where each picture lands on the page, and counts the shapes drawn", () => {
    const codes = { save: 1, restore: 2, transform: 3, paintFormXObjectBegin: 4, paintFormXObjectEnd: 5, constructPath: 6, paintImageXObject: 7, paintInlineImageXObject: 8, showText: 9 };
    const ops: [number, unknown[]][] = [
      [codes.save, []], [codes.transform, [480, 0, 0, 270, 100, 100]], [codes.paintImageXObject, ["img_p0_1", 800, 450]], [codes.restore, []],
      [codes.constructPath, []], [codes.showText, []], [codes.constructPath, []],
      // A picture inside a group is placed by the group's own transform as well.
      [codes.paintFormXObjectBegin, [[2, 0, 0, 2, 0, 0]]], [codes.transform, [48, 0, 0, 27, 10, 10]], [codes.paintInlineImageXObject, [{ width: 16, height: 9 }]], [codes.paintFormXObjectEnd, []],
    ];
    expect(pageDrawing({ fnArray: ops.map(([code]) => code), argsArray: ops.map(([, args]) => args) }, codes, 960, 540)).toEqual({
      paths: 2,
      images: [{ area: 0.25, at: "100,100,480,270,800x450", id: "img_p0_1" }, { area: 0.01, at: "20,20,96,54,16x9", id: "inline" }],
    });
  });

  it("knows a slide that shows a picture or a diagram from one that only wears the template", () => {
    const logo = image(0.001, "96,28,20,20,64x64", "logo");
    const plain = () => drawn(slide(), { images: [logo], paths: 6 });
    expect(pictured([
      plain(), plain(), plain(), plain(),
      drawn(slide(), { images: [logo, image(0.3, "100,100,500,300,800x480")], paths: 6 }),
      drawn(slide(), { images: [logo], paths: 60 }),
      // A rule under the title and a tinted text box are not a diagram.
      drawn(slide(), { images: [logo], paths: 21 }),
      // Several small pictures add up.
      drawn(slide(), { images: [logo, image(0.015, "a"), image(0.015, "b"), image(0.015, "c")], paths: 6 }),
    ])).toEqual([false, false, false, false, true, true, false, true]);
    const fullPage = (id: string) => drawn(slide(), { images: [image(1, "0,0,960,540,1920x1080", id)] });
    const eight = (id: (page: number) => string) => pictured(Array.from({ length: 8 }, (_, page) => fullPage(id(page))));
    expect(eight(() => "background")).toEqual(Array(8).fill(false));
    // A deck of photos puts a different one in the same place each time.
    expect(eight((page) => `photo ${page}`)).toEqual(Array(8).fill(true));
    // A short deck may be one slide built up in steps, its picture staying put.
    expect(pictured(["a", "a", "a"].map(fullPage))).toEqual([true, true, true]);
    expect(pictured([slide()])).toEqual([false]);
  });

  it("keeps a slide that is only a picture, and a step whose picture is replaced", () => {
    const photo = (at: string) => ({ images: [image(0.4, at)] });
    const deck = [
      drawn(slide(run("Demo", 50, 450, 40)), photo("first")),
      drawn(slide(run("Demo", 50, 450, 40)), photo("second")),
      drawn(slide(run("Demo", 50, 450, 40), ...bullet("It works", 300)), photo("second")),
      drawn(slide(), photo("third")),
      drawn(slide(), photo("fourth")),
      slide(),
    ];
    expect(slides(deck).map((s) => [s.page, s.title, s.pictured])).toEqual([[1, "Demo", true], [3, "Demo", true], [4, "", true], [5, "", true]]);
  });

  it("shows a slide's picture under its title when there is somewhere to keep it", () => {
    const url = "https://example.com/slides/lecture06.pdf";
    const deck = [
      slide(run("Agent Design", 150, 260, 60), run("CS 329Z", 150, 180, 30)),
      drawn(slide(run("How an agent loops", 50, 450, 40), ...bullet("It acts, observes, and decides again", 300)), { paths: 60 }),
      drawn(slide(), { images: [image(0.5, "photo")] }),
    ];
    const html = pdfHtml(deck, {}, url, picture)!;
    expect(html).toContain(`<h2>How an agent loops</h2><img data-slide src="${picture(2)}" alt="Slide 2: How an agent loops"><p>It acts, observes, and decides again.</p>`);
    expect(html).toContain(`<h2>Slide 3</h2><img data-slide src="${picture(3)}" alt="Slide 3">`);
    const blocks = readingBlocks(htmlToText(html, url).text);
    expect(blocks.map((block) => block.kind === "visual" ? block.visual : block.text)).toEqual([
      "# Agent Design\n\nCS 329Z.\n\n## How an agent loops",
      { kind: "slide", src: picture(2), alt: "Slide 2: How an agent loops", caption: "" },
      "It acts, observes, and decides again.\n\n## Slide 3",
      { kind: "slide", src: picture(3), alt: "Slide 3", caption: "" },
    ]);
    // Without anywhere to keep pictures the deck is its words alone.
    const words = pdfHtml(deck, {}, url)!;
    expect(words).not.toContain("<img");
    expect(words).not.toContain("Slide 3");
  });

  it("names a deck after its opening slide, falling back to the file", () => {
    const body = slide(run("Points", 50, 450, 40), ...bullet("A point long enough to count as something to read aloud", 300));
    const named = htmlToText(pdfHtml([body], { title: "Microsoft PowerPoint - lec1.pptx", author: " Diyi  Yang ", created: "D:20260923221412+00'00'" }, "https://example.com/slides/lecture%2001.pdf")!, "https://example.com/slides/lecture%2001.pdf");
    expect(named.title).toBe("Points");
    expect(named.meta).toMatchObject({ author: "Diyi Yang", published: "2026-09-23" });
    const untitled = slide(...bullet("A point long enough to count as something to read aloud", 300), ...bullet("And another one", 250), ...bullet("And a third", 200), ...bullet("And a fourth", 150));
    expect(htmlToText(pdfHtml([untitled], {}, "https://example.com/slides/lecture%2001.pdf")!, "https://example.com").title).toBe("lecture 01");
  });
});

// Loading pdf.js takes a second alone and several when every other test file is starting too.
describe("a PDF file", { timeout: 30_000 }, () => {
  it("becomes one titled section per slide, in the reader's own format", async () => {
    const url = "https://web.stanford.edu/class/cs329z/slides/lecture06.pdf";
    const { pages } = await readPdf(buildPdf(DECK));
    expect(pages).toHaveLength(2);
    const page = htmlToText((await pdfPage(buildPdf(DECK), url))!, url);
    expect(page.title).toBe("Agent Design");
    expect(page.domain).toBe("web.stanford.edu");
    // "tt" is drawn as one glyph that reads "=" unless the file's own replacement text is used.
    expect(page.text).toBe("# Agent Design\n\nCS 329Z.\n\n## Design patterns\n\nWorkflows chain model calls in a fixed order. Agents choose their next step.");
  });

  it("is refused when it cannot be opened", async () => {
    expect(await pdfPage(Buffer.from("%PDF-1.4\nnot really"), "https://example.com/broken.pdf")).toBeNull();
  });

  it("has its diagram slide drawn as a picture, kept for the reader to show", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readaloud-slides-"));
    try {
      const file = buildPdf([...DECK, DIAGRAM]);
      const { pages } = await readPdf(file);
      expect(pages.map((page) => page.drawing?.paths)).toEqual([0, 0, 50]);
      const store = new SlideStore(directory);
      const html = (await pdfPage(file, "https://example.com/deck.pdf", store))!;
      const [src] = html.match(/\/api\/slides\/[a-f0-9]{32}\/3\.jpg/)!;
      expect(html.match(/<img/g)).toHaveLength(1);
      expect(html).toContain(`<h2>How an agent loops</h2><img data-slide src="${src}" alt="Slide 3: How an agent loops">`);
      const jpeg = await readFile((await store.picture(src.split("/")[3], 3))!);
      expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff]);
      // 1280 pixels wide, as a baseline JPEG says in its frame header.
      const frame = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
      expect([jpeg.readUInt16BE(frame + 7), jpeg.readUInt16BE(frame + 5)]).toEqual([1280, 720]);
      await store.idle();
      // Once its pictures are drawn the deck itself is not kept.
      expect(await readdir(join(directory, src.split("/")[3]))).toEqual(["3.jpg"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("draws only the pages asked for that the file has", async () => {
    const seen: number[] = [];
    await drawPages(buildPdf(DECK), [2, 9, 0], async (page, jpeg) => { seen.push(page); expect(jpeg.byteLength).toBeGreaterThan(1000); });
    expect(seen).toEqual([2]);
    await expect(drawPages(Buffer.from("%PDF-1.4\nnot really"), [1], async () => {})).rejects.toThrow();
  });
});
