// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { bookContents, pageKey, sectionsOf } from "./book";
import { fetchReadable, htmlToText } from "./fetchUrl";

const SITE = "https://book.example";
const CHAPTERS = [["01-http", "HTTP & CORS"], ["02-routing", "Routing"], ["03-databases", "Databases"], ["04-caching", "Caching"]];
const nav = `<nav aria-label="All chapters"><a href="/">Overview</a><ol>${CHAPTERS.map(([slug, title], i) =>
  `<li><a href="/${slug}/"><span>0${i + 1}</span><span>${title}</span></a></li>`).join("")}</ol></nav>`;
const contentsPage = `<title>Backend Basics — a four-chapter reference</title>${nav}<main><h1>Backend Basics</h1>
  <a href="/01-http/">Start with Chapter 01</a>
  <ul>${CHAPTERS.map(([slug, title], i) => `<li><a class="card" href="/${slug}/"><span>0${i + 1}</span><span class="card-title">${title}</span><span>A long blurb about ${title}.</span><span>2 hours</span></a></li>`).join("")}</ul></main>`;
const chapterPage = (i: number) => `<title>${CHAPTERS[i][1]} · Chapter 0${i + 1} · Backend Basics</title>${nav}
  <main><article><h2>Start here</h2><p>Body of the chapter.</p><ol><li><a href="#one">1. First section</a></li><li><a href="#two">2. Second section</a></li><li><a href="#three">3. Third section</a></li></ol></article>
  <nav>${i > 0 ? `<a rel="prev" href="/${CHAPTERS[i - 1][0]}/">Previous</a>` : ""}${i < 3 ? `<a rel="next" href="/${CHAPTERS[i + 1][0]}/">Next</a>` : ""}</nav></main>`;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("finding the book a page belongs to", () => {
  it("reads the chapters off a contents page, named by their headline rather than their blurb", () => {
    const book = bookContents(parse(contentsPage), `${SITE}/`);
    expect(book).toMatchObject({ title: "Backend Basics", index: null });
    expect(book!.chapters).toEqual(CHAPTERS.map(([slug, title]) => ({ url: `${SITE}/${slug}/`, title })));
  });

  it("places a chapter in the same book from the navigation it carries", () => {
    const contents = bookContents(parse(contentsPage), `${SITE}/`)!;
    const chapter = bookContents(parse(chapterPage(2)), `${SITE}/03-databases/`)!;
    expect(chapter).toMatchObject({ id: contents.id, title: "Backend Basics", index: 2 });
    expect(chapter.chapters).toEqual(contents.chapters);
    // The chapter's own numbered sections link within the page and are not chapters.
    expect(chapter.chapters[2].title).toBe("Databases");
  });

  it("treats a trailing slash, an index file and a fragment as the same page", () => {
    expect(pageKey(`${SITE}/03-databases/index.html#indexes`)).toBe(pageKey(`${SITE}/03-databases`));
    expect(bookContents(parse(chapterPage(0)), `${SITE}/01-http/index.html`)?.index).toBe(0);
  });

  it("follows numbers in the addresses when the links themselves carry none", () => {
    const html = `<title>Notes</title><main><ul>${["1-intro|Introduction", "2-types|Types", "3-traits|Traits"].map((c) => `<li><a href="/notes/${c.split("|")[0]}.html">${c.split("|")[1]}</a></li>`).join("")}</ul></main>`;
    const book = bookContents(parse(html), `${SITE}/notes/`);
    expect(book?.chapters.map((c) => c.title)).toEqual(["Introduction", "Types", "Traits"]);
    expect(book?.index).toBeNull();
  });

  it("leaves ordinary pages alone", () => {
    // A numbered "most read" box names no chapters and sits outside any contents list.
    const popular = `<title>News</title><main><article><p>Story.</p></article><div class="popular"><ol>${[1, 2, 3, 4, 5].map((n) => `<li><a href="/news/story-${"abcde"[n - 1]}"><span>${n}</span><span>Headline ${n}</span></a></li>`).join("")}</ol></div></main>`;
    expect(bookContents(parse(popular), `${SITE}/`)).toBeNull();
    // Two numbered links are not a book, and neither are numbered links to somewhere else.
    expect(bookContents(parse(`<nav><a href="/1-a/">1. A</a><a href="/2-b/">2. B</a></nav>`), `${SITE}/`)).toBeNull();
    expect(bookContents(parse(`<nav><a href="https://other.example/1-a/">1. A</a><a href="https://other.example/2-b/">2. B</a><a href="https://other.example/3-c/">3. C</a></nav>`), `${SITE}/`)).toBeNull();
    // A contents list for a different part of the site does not make this page its contents page.
    expect(bookContents(parse(`<nav>${[1, 2, 3].map((n) => `<a href="/guide/${n}-step/">${n}. Step</a>`).join("")}</nav><article><p>Unrelated post.</p></article>`), `${SITE}/blog/post/`)).toBeNull();
    expect(bookContents(parse("<title>Plain</title><article><p>Just an article.</p></article>"), `${SITE}/post`)).toBeNull();
  });

  it("comes back with the fetched page", () => {
    expect(htmlToText(chapterPage(1), `${SITE}/02-routing/`).book).toMatchObject({ index: 1, title: "Backend Basics" });
    expect(htmlToText("<article><p>Just an article, long enough to read.</p></article>", `${SITE}/post`).book).toBeUndefined();
  });
});

describe("finding a course's lectures", () => {
  const SLIDES = "https://web.school.example/class/cs101/slides";
  const row = (week: number, date: string, title: string, links: string, extra = "") => `<tr><td>${week}</td><td>${date}</td><td>
    ${extra}<span class="lec-title">${title}</span><span class="lec-desc">What the lecture covers, at some length.</span>
    <span class="slides-link">${links}</span></td><td><b>Readings</b>: <ul><li><a href="https://arxiv.org/abs/1706.03762">Attention Is All You Need.</a></li></ul></td></tr>`;
  const schedule = `<title>CS101 | Building Things</title><meta property="og:site_name" content="School CS101">
    <h1>CS 101: Building Things</h1><p>Welcome. See the <a href="logistics.html">Logistics</a> page and the <a href="https://web.school.example/class/cs101/assignments/paper_video.pdf">handout</a>.</p>
    <table><thead><tr><th>Week</th><th>Date</th><th>Lecture</th><th>Material</th></tr></thead><tbody>
    ${row(1, "Wed Sep 23", "Introduction — What Are Systems?", `<a href="${SLIDES}/lecture01.pdf">Slides</a> <a href="https://youtu.be/abc">Video</a>`, '<span class="theme-tag">Foundations</span>')}
    ${row(2, "Mon Sep 28", "Models for Builders", `<a href="${SLIDES}/lecture02.pdf">Slides</a>`)}
    ${row(2, "Wed Sep 30", "📺 Guest Lecture: Retrieval", `<a href="https://speaker.example">Speaker</a> <a href="${SLIDES}/lecture03.pdf">Slides</a>`)}
    ${row(3, "Mon Oct 5", "Fireside Chat", "")}
    ${row(3, "Wed Oct 7", "Tools &amp; Function Calling", `<a href="${SLIDES}/lecture05.pdf">Slides</a>`)}
    </tbody></table>`;
  const course = (html: string, url = "https://cs101.school.example/") => bookContents(parse(html), url);

  it("shelves the decks a schedule links, wherever they are kept, named by their rows", () => {
    const found = course(schedule)!;
    expect(found).toMatchObject({ title: "CS 101: Building Things", index: null, kind: "course", contents: "https://cs101.school.example/" });
    // Lecture 4 had no slides: the ones there are keep their order.
    expect(found.chapters).toEqual([
      { url: `${SLIDES}/lecture01.pdf`, title: "Introduction — What Are Systems?" },
      { url: `${SLIDES}/lecture02.pdf`, title: "Models for Builders" },
      { url: `${SLIDES}/lecture03.pdf`, title: "Guest Lecture: Retrieval" },
      { url: `${SLIDES}/lecture05.pdf`, title: "Tools & Function Calling" },
    ]);
    expect(htmlToText(`<html><body>${schedule}</body></html>`, "https://cs101.school.example/").book?.id).toBe(found.id);
  });

  it("stays the same course as more lectures are posted, and whichever way the page lists them", () => {
    const list = (numbers: number[]) => `<h1>Course</h1><ul>${numbers.map((n) => `<li>Lecture ${n}: Topic ${n} <a href="slides/lec${n}.pdf">[slides]</a></li>`).join("")}</ul>`;
    const early = course(list([1, 2, 3]))!;
    const later = course(list([5, 4, 3, 2, 1]))!;
    expect(later.id).toBe(early.id);
    expect(later.chapters.map((chapter) => chapter.title)).toEqual(["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"]);
    expect(later.chapters[4].url).toBe("https://cs101.school.example/slides/lec5.pdf");
  });

  it("names a lecture by its own link, by a plain table row, or by its number", () => {
    const named = course(`<h1>Course</h1><ol>${["Intro", "Trees", "Graphs"].map((title, i) => `<li><a href="/files/cs-fall-lecture0${i + 1}-${title.toLowerCase()}.pdf">Lecture ${i + 1}: ${title}</a></li>`).join("")}</ol>`)!;
    expect(named.chapters.map((chapter) => chapter.title)).toEqual(["Intro", "Trees", "Graphs"]);
    const table = course(`<h1>Course</h1><table>${["Intro", "Trees", "Graphs"].map((title, i) => `<tr><td>Week ${i + 1}</td><td>Jan ${9 + i}</td><td>${title} and friends</td><td><a href="slides/0${i + 1}-${title}.pdf">pdf</a></td></tr>`).join("")}</table>`)!;
    expect(table.kind).toBe("course");
    expect(table.chapters.map((chapter) => chapter.title)).toEqual(["Intro and friends", "Trees and friends", "Graphs and friends"]);
    const bare = course(`<h1>Course</h1><p>${[1, 2, 3].map((n) => `<a href="lecture${n}.pdf">Slides</a>`).join(" ")}</p>`)!;
    expect(bare.chapters.map((chapter) => chapter.title)).toEqual(["Lecture 1", "Lecture 2", "Lecture 3"]);
  });

  it("calls a book's chapters chapters, and leaves other files alone", () => {
    const chapters = course(`<h1>The Book</h1><ul>${[1, 2, 3].map((n) => `<li><a href="book/chapter${n}.pdf">Chapter ${n}: Part ${n}</a></li>`).join("")}</ul>`)!;
    expect(chapters.kind).toBeUndefined();
    expect(chapters.contents).toBe("https://cs101.school.example/");
    // Homework and one-off handouts are not a numbered series of lectures.
    expect(course(`<a href="hw1.pdf">HW 1</a><a href="hw2.pdf">HW 2</a><a href="hw3.pdf">HW 3</a><a href="syllabus.pdf">Syllabus</a>`)).toBeNull();
    expect(course(`<a href="lecture1.pdf">One</a><a href="lecture2.pdf">Two</a>`)).toBeNull();
    // Numbers too far apart are years or sizes, not a series.
    expect(course(`<a href="lecture1.pdf">a</a><a href="lecture40.pdf">b</a><a href="lecture90.pdf">c</a>`)).toBeNull();
  });
});

describe("finding a track's notes", () => {
  afterEach(() => vi.unstubAllGlobals());
  const STUDY = "https://study.example";
  const TRACK = `${STUDY}/tracks/computer-networks`;
  const NOTES = [["what-is-computer-networking", "What is Computer Networking?"], ["osi-model", "OSI Model"], ["tcp-ip-model", "TCP/IP Model"], ["subnet-mask", "Subnet Mask"]];
  const crumbs = (...trail: [string, string][]) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) })}</script>`;
  const trackTrail: [string, string][] = [["Home", `${STUDY}/`], ["Library", `${STUDY}/library`], ["Computer Networks", TRACK]];
  const trackPage = `<title>Computer Networks notes | StudyAtlas</title><meta property="og:site_name" content="StudyAtlas">
    <link rel="canonical" href="${TRACK}">${crumbs(...trackTrail)}
    <main><nav><a href="/library">← Library</a></nav><h1>Computer Networks</h1><p>Networking concepts every backend developer should be able to explain.</p>
    <ul>${NOTES.map(([slug, title]) => `<li><a href="/notes/${slug}">${title}</a> — What ${title} is about.</li>`).join("")}</ul></main>`;
  const notePage = (i: number) => `<title>${NOTES[i][1]} | StudyAtlas</title><meta property="og:type" content="article">
    <script type="application/ld+json">${JSON.stringify([{ "@type": "Article", headline: NOTES[i][1] }, JSON.parse(crumbs(...trackTrail, [NOTES[i][1], `${STUDY}/notes/${NOTES[i][0]}`]).replace(/<\/?script[^>]*>/g, ""))])}</script>
    <main><nav><a href="/library">← Library</a> · Computer Networks</nav><article><h1>${NOTES[i][1]}</h1><p>The body of the note, long enough to be worth reading aloud.</p></article></main>`;

  it("reads an unnumbered list of notes off a page that sits in the breadcrumbs and is little else", () => {
    const book = bookContents(parse(trackPage), TRACK);
    expect(book).toMatchObject({ title: "Computer Networks", index: null, contents: TRACK });
    expect(book!.chapters).toEqual(NOTES.map(([slug, title]) => ({ url: `${STUDY}/notes/${slug}`, title })));
  });

  it("finds a note's track on the page its breadcrumbs put it under, and opens the book at the note", async () => {
    const note = `${STUDY}/notes/${NOTES[1][0]}`;
    const fetched = vi.fn(async (input: string) => {
      const page = input === note ? notePage(1) : input === TRACK ? trackPage : null;
      return page ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetched);
    const result = await fetchReadable(note);
    expect(fetched.mock.calls.map(([input]) => input)).toEqual([note, TRACK]);
    expect(result.book).toMatchObject({ id: bookContents(parse(trackPage), TRACK)!.id, title: "Computer Networks", index: 1, contents: TRACK });
    expect(result).not.toHaveProperty("partOf");
  });

  it("reads a note as an article when the page above it lists no track", async () => {
    const note = `${STUDY}/notes/${NOTES[0][0]}`;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input === note
      ? new Response(notePage(0), { headers: { "content-type": "text/html" } })
      : new Response("<title>Library</title><main><h1>Library</h1><p>Browse everything.</p></main>", { headers: { "content-type": "text/html" } })));
    const result = await fetchReadable(note);
    expect(result.book).toBeUndefined();
    expect(result.text).toContain("The body of the note");
  });

  it("leaves lists that are not tracks alone", () => {
    // Without breadcrumbs ending on the page, an unnumbered list is just a list.
    expect(bookContents(parse(trackPage.replace(/<script[\s\S]*?<\/script>/, "")), TRACK)).toBeNull();
    // An archive of dated posts.
    const archive = trackPage.replace(/<\/a> —/g, "</a> <time datetime=\"2026-01-02\">2 Jan</time> —");
    expect(bookContents(parse(archive), TRACK)).toBeNull();
    // An article that happens to hold a list of links among plenty of others.
    const article = trackPage.replace("<ul>", `<p>${[1, 2, 3, 4, 5].map((n) => `<a href="/elsewhere/${n}">see ${n}</a>`).join(" ")}</p><ul>`);
    expect(bookContents(parse(article), TRACK)).toBeNull();
  });
});

describe("finding the sections of a book in parts", () => {
  afterEach(() => vi.unstubAllGlobals());
  const DOCS = "https://tutorial.example/learn";
  const PARTS: [string, string, string[]][] = [
    ["before-we-begin", "Before We Begin", ["How this works", "Meet the shop"]],
    ["storage", "How Data Lives on Disk", ["Hard disks", "Pages", "Slotted pages"]],
    ["indexes", "Indexes: Finding Data Fast", ["Why indexes exist", "B-trees"]],
  ];
  const slug = (title: string) => title.toLowerCase().replace(/[^a-z]+/g, "-");
  const partUrl = (p: number) => `${DOCS}/${PARTS[p][0]}/`;
  const sectionUrl = (p: number, s: number) => `${partUrl(p)}${slug(PARTS[p][2][s])}/`;
  /** The sidebar every page but the first carries: all the parts, and the sections of the one being read. */
  const sidebar = (open: number) => `<nav aria-label="Docs sidebar"><ul>${PARTS.map(([, title, sections], p) =>
    `<li><a href="${partUrl(p)}">${p} · ${title}</a>${p === open ? `<ul>${sections.map((name, s) => `<li><a href="${sectionUrl(p, s)}">${p}.${s + 1} · ${name}</a></li>`).join("")}</ul>` : ""}</li>`).join("")}</ul></nav>`;
  const body = "<main><article><h1>Heading</h1><p>The body of the page, long enough to be worth reading aloud.</p></article></main>";
  const home = `<title>How it really works | Tutorial</title><main><h1>Tutorial</h1><p>A tutorial in parts, read one building block at a time.</p>
    <ul class="contents">${PARTS.map(([, title], p) => `<li><a href="${partUrl(p)}"><span>${p}</span><h3>${title}</h3><p>What ${title} covers.</p></a></li>`).join("")}</ul></main>`;
  const partPage = (p: number) => `<title>${p} · ${PARTS[p][1]} | Tutorial</title>${sidebar(p)}${body}`;
  const sectionPage = (p: number, s: number) => `<title>${p}.${s + 1} · ${PARTS[p][2][s]} | Tutorial</title>${sidebar(p)}${body}`;
  const whole = PARTS.flatMap(([, title, sections], p) => [{ url: partUrl(p), title }, ...sections.map((name, s) => ({ url: sectionUrl(p, s), title: name }))]);
  const site = () => {
    const pages = new Map<string, string>([[`${DOCS}/`, home]]);
    PARTS.forEach(([, , sections], p) => {
      pages.set(partUrl(p), partPage(p));
      sections.forEach((_, s) => pages.set(sectionUrl(p, s), sectionPage(p, s)));
    });
    const fetched = vi.fn(async (input: string) => pages.has(input)
      ? new Response(pages.get(input), { headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };

  it("keeps a part's sections out of the count of parts, and puts them after their part", () => {
    const book = bookContents(parse(partPage(1)), partUrl(1))!;
    expect(book.chapters.map((c) => c.title)).toEqual(["Before We Begin", "How Data Lives on Disk", "Hard disks", "Pages", "Slotted pages", "Indexes: Finding Data Fast"]);
    expect(book.index).toBe(1);
    expect(book.unread).toEqual([partUrl(0), partUrl(2)]);
    expect(sectionsOf(parse(partPage(1)), partUrl(1))).toEqual(whole.slice(4, 7));
  });

  it("places a section in the book its part belongs to", () => {
    const book = bookContents(parse(sectionPage(1, 2)), sectionUrl(1, 2))!;
    expect(book).toMatchObject({ id: bookContents(parse(home), `${DOCS}/`)!.id, index: 4 });
    expect(book.chapters[4].title).toBe("Slotted pages");
  });

  it("reads every part's page for its sections, whichever page of the book is fetched", async () => {
    const fetched = site();
    const contents = (await fetchReadable(`${DOCS}/`)).book!;
    expect(contents.chapters).toEqual(whole);
    expect(contents).toMatchObject({ index: null, contents: `${DOCS}/` });
    expect(contents).not.toHaveProperty("unread");
    fetched.mockClear();
    const section = (await fetchReadable(sectionUrl(2, 0))).book!;
    expect(section.chapters).toEqual(whole);
    expect(section).toMatchObject({ id: contents.id, index: 8 });
    // The part being read shows its sections already: only the other two are asked.
    expect(fetched.mock.calls.map(([input]) => input).sort()).toEqual([partUrl(0), partUrl(1), sectionUrl(2, 0)].sort());
  });

  it("asks an ordinary book's first chapter and no more", async () => {
    const pages = new Map(CHAPTERS.map(([slug], i) => [`${SITE}/${slug}/`, chapterPage(i)]));
    const fetched = vi.fn(async (input: string) => new Response(pages.get(input) ?? contentsPage, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetched);
    const book = (await fetchReadable(`${SITE}/`)).book!;
    expect(fetched.mock.calls.map(([input]) => input)).toEqual([`${SITE}/`, `${SITE}/01-http/`]);
    expect(book.chapters).toEqual(CHAPTERS.map(([slug, title]) => ({ url: `${SITE}/${slug}/`, title })));
    expect(book).not.toHaveProperty("unread");
  });

  it("takes an unnumbered last part whose sections are numbered after the others, and leaves other trailing links alone", async () => {
    const APPENDICES = `${DOCS}/appendices/`;
    const glossary = `${APPENDICES}glossary/`;
    const lab = `${APPENDICES}lab/`;
    // The cards go on to the appendices and the navigation to an About page; a figure links its full-size view.
    const cards = home.replace("</ul>", `<li><a href="${APPENDICES}"><span>A</span><h3>Appendices</h3><p>The glossary and the lab.</p></a></li></ul><p><a href="${DOCS}/figures/1-0-1/"><img src="/f.svg" alt=""></a></p>`);
    const appendixSidebar = sidebar(-1).replace("</ul></nav>", `<li><a href="${APPENDICES}">Appendices</a><ul><li><a href="${glossary}">3.1 · Glossary</a></li><li><a href="${lab}">3.2 · Setting up your lab</a></li></ul></li></ul></nav>`);
    const fetched = site();
    const pages = new Map<string, string>([[`${DOCS}/`, cards], [APPENDICES, `<title>Appendices</title>${appendixSidebar}${body}`], [glossary, `<title>Glossary</title>${appendixSidebar}${body}`]]);
    const fallback = fetched.getMockImplementation()!;
    fetched.mockImplementation(async (input: string) => pages.has(input) ? new Response(pages.get(input), { headers: { "content-type": "text/html" } }) : fallback(input));
    const appendix = [{ url: APPENDICES, title: "Appendices" }, { url: glossary, title: "Glossary" }, { url: lab, title: "Setting up your lab" }];
    const contents = (await fetchReadable(`${DOCS}/`)).book!;
    expect(contents.chapters).toEqual([...whole, ...appendix]);
    expect(contents).not.toHaveProperty("tail");
    // From the appendices' own pages, the same book.
    const fromGlossary = (await fetchReadable(glossary)).book!;
    expect(fromGlossary).toMatchObject({ id: contents.id, index: whole.length + 1 });
    expect(fromGlossary.chapters).toEqual(contents.chapters);
    expect(bookContents(parse(pages.get(APPENDICES)!), APPENDICES)?.chapters.slice(-3)).toEqual(appendix);
    // A trailing link whose page numbers no sections after the parts stays out.
    pages.set(APPENDICES, `<title>About</title>${sidebar(-1)}${body}`);
    expect((await fetchReadable(`${DOCS}/`)).book!.chapters).toEqual(whole);
  });

  it("leaves a part that can't be read as one chapter", async () => {
    const fetched = site();
    fetched.mockImplementation(async (input: string) => input === partUrl(1) ? new Response("nope", { status: 500 })
      : new Response(input === `${DOCS}/` ? home : partPage(PARTS.findIndex((_, p) => partUrl(p) === input)), { headers: { "content-type": "text/html" } }));
    const book = (await fetchReadable(`${DOCS}/`)).book!;
    expect(book.chapters).toEqual(whole.filter((c) => c.url === partUrl(1) || !c.url.startsWith(partUrl(1))));
  });
});
