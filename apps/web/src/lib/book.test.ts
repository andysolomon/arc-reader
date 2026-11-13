// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { bookContents, pageKey } from "./book";
import { htmlToText } from "./fetchUrl";

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
