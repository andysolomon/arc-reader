import { describe, it, expect } from "vitest";
import { splitBook } from "./bookText";

/** A paragraph of running text, about 450 characters. */
const para = (about: string, sentences = 6) => Array.from({ length: sentences }, (_, i) => `${about} went on in sentence ${i + 1}, long enough that the paragraph reads as prose.`).join(" ");
/** A chapter's worth of paragraphs, set in lines of a printed width as a scan's text is. */
const wrap = (text: string, width = 60) => text.split(" ").reduce<string[]>((lines, word) => {
  const last = lines[lines.length - 1];
  if (last !== undefined && last.length + word.length < width) lines[lines.length - 1] = `${last} ${word}`;
  else lines.push(word);
  return lines;
}, []).join("\n");
const body = (about: string, paragraphs = 4) => Array.from({ length: paragraphs }, (_, i) => wrap(para(`${about} ${i + 1}`))).join("\n\n");
const titles = (raw: string) => splitBook(raw).map((part) => part.title);

describe("a scanned book's text", () => {
  const scan = [
    "THE  GREAT  BOOK", "BY  A.  WRITER", "CONTENTS.",
    "CHAPTER  I.  The  Start  1", "CHAPTER  II.  The  Middle  9", "CHAPTER  III.  The  Close  21",
    "CHAPTER    I.\nTHE    START.",
    body("The start"),
    // A page ends mid-word: the header and number of the next page land inside the paragraph.
    "The  ship  came  slowly  into  the  har-\n\n\n12  THE    GREAT    BOOK.\n\nbour,  and  the  crowd  on  the  quay  fell  silent.",
    "CHAPTER   Il",
    "THE   MIDDLE",
    body("The middle"),
    "13",
    "CHAPTER  III.",
    body("The close"),
    "\"  Is  it  over  ? \"  she  asked.",
    "THE  END.",
    "PRINTED  BY  WHITTINGHAM  AND  CO.,  LONDON.",
    "Return this book to the library from which it was borrowed",
  ].join("\n\n\n");
  const parts = splitBook(scan);

  it("is cut into its chapters, past the contents list", () => {
    expect(parts.map((part) => part.title)).toEqual(["The Start", "The Middle", "Chapter 3"]);
    expect(parts[0].text.startsWith("# Chapter 1: The Start\n\nThe start 1 went on")).toBe(true);
    // "Il" is how a scan reads II.
    expect(parts[1].text.startsWith("# Chapter 2: The Middle\n\n")).toBe(true);
    expect(parts[2].text.startsWith("# Chapter 3\n\n")).toBe(true);
  });

  it("joins lines and the paragraphs a page break cut, without the page's header and number", () => {
    expect(parts[0].text).toContain("The ship came slowly into the harbour, and the crowd on the quay fell silent.");
    expect(parts[0].text).not.toMatch(/GREAT BOOK|\b12\b/);
    expect(parts[1].text).not.toMatch(/\n13$/);
    expect(parts[0].text.split("\n\n")).toHaveLength(6);
  });

  it("stops at the end of the book and tidies spaced punctuation", () => {
    expect(parts[2].text.endsWith("\" Is it over? \" she asked.")).toBe(true);
    expect(parts[2].text).not.toMatch(/WHITTINGHAM|library/);
  });

  it("keeps a number that ends a paragraph on a line of its own", () => {
    const [only] = splitBook(`${wrap(para("The year"))}\nHe was born in the spring of\n1815.\n\n${wrap(para("The next year"))}`);
    expect(only.text).toContain("He was born in the spring of 1815.\n\nThe next year went on");
  });

  it("drops a header the book keeps repeating even where the page number was lost", () => {
    const pages = Array.from({ length: 8 }, (_, i) => `${body(`Page ${i + 1}`, 1)}\n\n\nTHE GREAT BOOK`).join("\n\n\n");
    const [only] = splitBook(pages);
    expect(only.text).not.toContain("GREAT BOOK");
    expect(only.text).toContain("Page 8 1 went on");
  });
});

describe("headings a scan gets wrong", () => {
  it("reads a numeral that only fits the sequence once misread letters are undone", () => {
    const raw = ["CHAPTER X.", body("Ten"), "CHAPTER XL", body("Eleven"), "CHAPTER XIL", body("Twelve"), "CHAPTER XQ", body("Thirteen")].join("\n\n");
    expect(titles(raw)).toEqual(["Chapter 10", "Chapter 11", "Chapter 12", "Chapter 13"]);
  });

  it("keeps the first chapter when its heading was lost to a decorated initial", () => {
    const raw = ["A NOVEL", "LONDON 1894", body("The opening"), "CHAPTER II.", body("Two"), "CHAPTER III.", body("Three"), "CHAPTER IV.", body("Four")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts.map((part) => part.title)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"]);
    expect(parts[0].text.startsWith("# Chapter 1\n\nThe opening 1 went on")).toBe(true);
  });

  it("does not take a chapter's heading repeated atop its pages for a new chapter", () => {
    const raw = ["CHAPTER I.", body("One"), "CHAPTER I.", body("More of one"), "CHAPTER II.", body("Two"), "CHAPTER III.", body("Three")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts.map((part) => part.title)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(parts[0].text).toContain("More of one 1 went on");
  });

  it("tells a title set under the number from the chapter's first words", () => {
    const raw = ["CHAPTER I.\nLIGHT IN THE DARKNESS,", body("One"), "CHAPTER II.\n\" HAVE been thinking it over again,\" said her", "uncle, as they drove from the town.", body("Two"), "CHAPTER III.", body("Three")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts.map((part) => part.title)).toEqual(["Light in the Darkness", "Chapter 2", "Chapter 3"]);
    expect(parts[1].text.startsWith("# Chapter 2\n\n\" HAVE been thinking it over again,\" said her uncle, as they drove from the town.")).toBe(true);
  });

  it("does not take prose that opens with a chapter word for a heading", () => {
    const raw = ["Chapter 1", body("One"), "Part of the trouble was the weather.", "Book in hand, she left.", "Chapter 2", body("Two"), "Chapter 3", body("Three")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toContain("Part of the trouble was the weather.\n\nBook in hand, she left.");
  });
});

describe("a book's front matter and divisions", () => {
  it("keeps a preface as the opening and leaves the title page out", () => {
    const raw = ["THE GREAT BOOK", "PREFACE", body("The preface"), "STAVE ONE", body("One"), "STAVE TWO", body("Two"), "STAVE THREE", body("Three")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts.map((part) => part.title)).toEqual(["Opening", "Stave 1", "Stave 2", "Stave 3"]);
    expect(parts[0].text.startsWith("The preface 1 went on")).toBe(true);
  });

  it("does not mistake the last contents entry, with the preface beneath it, for a chapter", () => {
    const raw = ["Chapter 1", "Chapter 2", "Chapter 3", body("The preface"), "Chapter 1", body("One"), "Chapter 2", body("Two"), "Chapter 3", body("Three")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts.map((part) => part.title)).toEqual(["Opening", "Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(parts[0].text.startsWith("The preface 1 went on")).toBe(true);
  });

  it("opens a chapter with the part it begins, not the chapter before", () => {
    const raw = ["PART I.", "CHAPTER I.", body("One"), "CHAPTER II.", body("Two"), "PART II.\nTHE RETURN.", "(Being a continuation.)", "CHAPTER I.\nHOME AGAIN.", body("Three")].join("\n\n");
    const parts = splitBook(raw);
    expect(parts.map((part) => part.title)).toEqual(["Chapter 1", "Chapter 2", "Home Again"]);
    expect(parts[0].text.startsWith("## Part 1\n\n# Chapter 1\n\n")).toBe(true);
    expect(parts[1].text).not.toContain("Part 2");
    expect(parts[2].text.startsWith("## Part 2: The Return\n\n(Being a continuation.)\n\n# Chapter 1: Home Again\n\n")).toBe(true);
  });

  it("divides by books or parts when those are all the headings there are", () => {
    const raw = ["BOOK I", body("One"), "BOOK II", body("Two"), "BOOK III", body("Three")].join("\n\n");
    expect(titles(raw)).toEqual(["Book 1", "Book 2", "Book 3"]);
  });
});

describe("a transcribed book", () => {
  const raw = [
    "The Project Gutenberg Etext of A Tale", "Please take a look at the important information in this header. We encourage you to keep this file on your own disk, keeping an electronic path open for the next readers.",
    "*END*THE SMALL PRINT! FOR PUBLIC DOMAIN ETEXTS*Ver.04.29.93*END*",
    "A Tale", "by A. Writer",
    "Chapter 1\nMarseilles -- The Arrival.", body("One"), "He called it _magnificent_--and meant it.",
    "Chapter 2\nFather and Son.", body("Two"),
    "Chapter 3\nThe Catalans.", body("Three"),
    "End of Project Gutenberg Etext of A Tale", para("Donations to the project"),
  ].join("\n\n");
  const parts = splitBook(raw);

  it("is read without the licence around it", () => {
    expect(parts.map((part) => part.title)).toEqual(["Marseilles — The Arrival", "Father and Son", "The Catalans"]);
    expect(parts.map((part) => part.text).join("\n")).not.toMatch(/Gutenberg|SMALL PRINT|Donations/);
  });

  it("turns typed dashes and emphasis marks into what they stand for", () => {
    expect(parts[0].text).toContain("He called it magnificent—and meant it.");
  });
});

describe("a book without chapter headings", () => {
  it("is cut into parts of even length between paragraphs", () => {
    const parts = splitBook(Array.from({ length: 140 }, (_, i) => para(`Paragraph ${i + 1}`)).join("\n\n"));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.title)).toEqual(parts.map((_, i) => `Part ${i + 1}`));
    expect(parts.every((part) => part.text.length > 8_000 && part.text.length < 40_000)).toBe(true);
    expect(parts[1].text.startsWith("# Part 2\n\nParagraph ")).toBe(true);
  });

  it("stays whole when it is short", () => {
    expect(splitBook(body("A short piece"))).toEqual([{ title: "", text: expect.stringMatching(/^A short piece 1 went on/) }]);
    expect(splitBook("\n\n  \n")).toEqual([]);
  });
});
