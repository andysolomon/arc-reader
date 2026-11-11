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
