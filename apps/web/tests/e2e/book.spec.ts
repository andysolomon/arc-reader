import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
};

/** The book's site, from tests/stub-site.mjs: the app server fetches chapters itself, so the browser can't fake them. */
const SITE = `http://127.0.0.1:${process.env.E2E_SITE_PORT || 3996}`;

async function readLink(page: Page, url: string) {
  await page.goto("/");
  await page.getByLabel("Link to read").fill(url);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
}

test("a contents page becomes a book read chapter by chapter", async ({ page }) => {
  await readLink(page, `${SITE}/`);
  const contentsUrl = page.url();
  const offer = page.getByRole("complementary", { name: "Book" });
  await expect(offer).toContainText("This page lists the 3 chapters of Backend Basics");
  // The contents page waits to be replaced rather than reading itself out.
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible();
  await axe(page);

  await offer.getByRole("button", { name: "Add 3 chapters" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 3 chapters of Backend Basics" })).toBeVisible();
  // Chapter one takes the contents page's place and starts reading.
  await expect(page).not.toHaveURL(contentsUrl);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "HTTP & CORS" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Why HTTP" })).toBeVisible();
  const chapters = page.getByRole("navigation", { name: "Chapters" });
  await expect(chapters.getByRole("button")).toHaveCount(1);
  await expect(chapters.getByRole("button", { name: /Next · Chapter 2\s*Routing/ })).toBeVisible();

  // The end of a chapter points at the next one.
  await expect(page.getByRole("status").filter({ hasText: "Reading complete" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Next: Routing" }).click();
  await expect(page.getByText("Chapter 2 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Routing" })).toBeVisible();
  const text = page.getByRole("region", { name: "Document text" }).locator("article");
  await expect(text.getByRole("heading", { level: 3, name: "Dynamic routes" })).toBeVisible();
  // Callouts and tables are part of the chapter.
  await expect(text).toContainText("Methods say what, routes say where.");
  await expect(text).toContainText("Path: Which resource.");
  await expect(chapters.getByRole("button", { name: /Previous · Chapter 1\s*HTTP & CORS/ })).toBeVisible();
  await expect(chapters.getByRole("button", { name: /Next · Chapter 3\s*Databases/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Pause" }).isVisible()) await page.keyboard.press("Space");
  await axe(page);

  // The Library shows one book, not three articles and a contents page.
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const book = page.locator('li[data-book="Backend Basics"]');
  await expect(book).toContainText("3 chapters");
  await expect(book).toContainText("1 read");
  await expect(page.getByRole("button", { name: /three-chapter reference/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Chapters of Backend Basics" })).toHaveCount(0);
  await book.getByRole("button", { name: "Show chapters of Backend Basics" }).click();
  const rows = page.getByRole("list", { name: "Chapters of Backend Basics" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("1. HTTP & CORS");
  await expect(rows.nth(1)).toContainText("2. Routing");
  await expect(rows.nth(2)).toContainText("3. Databases");
  await axe(page);

  // Continue resumes at the first chapter that isn't finished.
  await book.getByRole("button", { name: "Continue Backend Basics" }).click();
  await expect(page.getByText("Chapter 2 of 3")).toBeVisible();
});

test("a single chapter offers the rest of its book, then and later", async ({ page }) => {
  await readLink(page, `${SITE}/02-routing/`);
  const offer = page.getByRole("complementary", { name: "Book" });
  await expect(offer).toContainText("This is chapter 2 of 3 in Backend Basics");
  await expect(page.getByRole("heading", { level: 1, name: "Routing" })).toBeVisible();
  await page.keyboard.press("Space");
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toBeHidden();

  // On its own the chapter is an ordinary row that says which book it is from.
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText("Ch. 2 · Backend Basics")).toBeVisible();
  await expect(page.locator("li[data-book]")).toHaveCount(0);
  await page.getByRole("button", { name: "Routing", exact: true }).click();

  await page.getByRole("button", { name: "Add the 2 missing chapters" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 chapters of Backend Basics" })).toBeVisible();
  const chapters = page.getByRole("navigation", { name: "Chapters" });
  await expect(chapters.getByRole("button", { name: /Previous · Chapter 1/ })).toBeVisible();
  await expect(chapters.getByRole("button", { name: /Next · Chapter 3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /missing chapter/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.locator('li[data-book="Backend Basics"]')).toContainText("3 chapters");
});

const ARCHIVE = "https://archive.org";
const prose = (about: string) => Array.from({ length: 6 }, (_, i) => `${about} went on in sentence ${i + 1}, long enough that the paragraph reads as prose.`).join(" ");
/** A scan's text: a title page, chapters under misread headings, and a page header between paragraphs. */
const SCAN = [
  "THE  COUNT  OF  MONTE-CRISTO", "LONDON  1888",
  "CHAPTER    I\n\n\nTHE   ARRIVAL", prose("The arrival"), "2  THE    COUNT    OF    MONTE-CRISTO.", prose("The harbour"), prose("The owner"), prose("The mate"),
  "CHAPTER    Il\n\n\nFATHER   AND   SON", ...["The father", "The son", "The neighbour", "The purse"].map(prose),
  "CHAPTER    III\n\n\nTHE   CATALANS", ...["The village", "The cousin", "The rival", "The tavern"].map(prose),
  "END  OF  VOLUME  I.", "University of California Library",
].join("\n\n\n");
const ITEMS: Record<string, unknown> = {
  countofmontecris01duma: {
    metadata: { mediatype: "texts", title: "The Count of Monte-Cristo", creator: "Dumas, Alexandre, 1802-1870", date: "1888" },
    files: [{ name: "countofmontecris01duma_djvu.txt", format: "DjVuTXT", size: String(SCAN.length) }],
  },
  countofmontecris0000alex_k5l0: {
    metadata: { mediatype: "texts", title: "The Count of Monte Cristo", "access-restricted-item": "true" },
    files: [{ name: "countofmontecris0000alex_k5l0_djvu.txt", format: "DjVuTXT", size: "113454", private: "true" }],
  },
};

/** The Internet Archive's metadata API and downloads, readable straight from the browser as the real ones are. */
async function serveArchive(page: Page) {
  const requested: string[] = [];
  await page.route(`${ARCHIVE}/**`, (route) => {
    const [, kind, id] = new URL(route.request().url()).pathname.split("/");
    requested.push(`${kind}/${id}`);
    const headers = { "access-control-allow-origin": "*" };
    if (kind === "metadata") return route.fulfill({ contentType: "application/json", headers, body: JSON.stringify(ITEMS[id] ?? {}) });
    if (kind === "download" && id === "countofmontecris01duma") return route.fulfill({ contentType: "text/plain; charset=utf-8", headers, body: SCAN });
    return route.fulfill({ status: 403, body: "Forbidden" });
  });
  return requested;
}

test("a book on the Internet Archive is read from its scan, chapter by chapter", async ({ page }) => {
  await serveArchive(page);
  // A link into the page viewer, as copied from the address bar.
  await readLink(page, `${ARCHIVE}/details/countofmontecris01duma/page/n7/mode/1up`);
  const offer = page.getByRole("complementary", { name: "Book" });
  await expect(offer).toContainText("This is chapter 1 of 3 in The Count of Monte-Cristo");
  await expect(page.getByRole("heading", { level: 1, name: "The Arrival" })).toBeVisible();
  const text = page.getByRole("region", { name: "Document text" }).locator("article");
  await expect(text.getByRole("heading", { level: 2, name: "Chapter 1: The Arrival" })).toBeVisible();
  // The page header between two paragraphs is gone, and so is the title page.
  await expect(text).not.toContainText("MONTE-CRISTO");
  await expect(text).not.toContainText("LONDON");
  await page.keyboard.press("Space");
  await axe(page);

  await offer.getByRole("button", { name: "Add the other 2 chapters" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 chapters of The Count of Monte-Cristo" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /Next · Chapter 2\s*Father and Son/ })).toBeVisible();

  await page.getByRole("link", { name: "Library", exact: true }).click();
  const book = page.locator('li[data-book="The Count of Monte-Cristo"]');
  await expect(book).toContainText("3 chapters");
  await book.getByRole("button", { name: "Show chapters of The Count of Monte-Cristo" }).click();
  const rows = page.getByRole("list", { name: "Chapters of The Count of Monte-Cristo" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("2. Father and Son");
  await expect(rows.nth(2)).toContainText("3. The Catalans");

  // The last chapter ends with the book, not with the library's stamp.
  await rows.nth(2).getByRole("button", { name: /The Catalans/ }).first().click();
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  await expect(text).toContainText("The tavern went on in sentence 6");
  await expect(text).not.toContainText("END OF VOLUME");
  await expect(text).not.toContainText("University of California");
});

test("a book the Internet Archive only lends is not imported, and says why", async ({ page }) => {
  const requested = await serveArchive(page);
  await page.goto("/");
  await page.getByLabel("Link to read").fill(`${ARCHIVE}/details/countofmontecris0000alex_k5l0/page/n7/mode/1up`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Archive.org only lends this book" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // Neither the locked text nor the viewer's page is asked for.
  expect(requested).toEqual(["metadata/countofmontecris0000alex_k5l0"]);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText("The Count of Monte Cristo")).toHaveCount(0);
});

/** A small EPUB 3: a cover, a copyright page and three chapters, two of them in one file. */
async function buildEpub(): Promise<Buffer> {
  const { strToU8, zipSync } = await import("fflate");
  const prose = (about: string) => Array.from({ length: 4 }, (_, p) => `<p>${Array.from({ length: 5 }, (_, i) => `${about} ${p + 1} went on in sentence ${i + 1}, long enough that the paragraph reads as prose.`).join(" ")}</p>`).join("");
  const page = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>The Farmyard</title></head><body>${body}</body></html>`;
  const files: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    "OEBPS/content.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Farmyard</dc:title><dc:creator>Jane Example</dc:creator></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="copy" href="copyright.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c23" href="ch2-3.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="cover"/><itemref idref="copy"/><itemref idref="c1"/><itemref idref="c23"/></spine></package>`,
    "OEBPS/nav.xhtml": page(`<nav epub:type="toc"><ol><li><a href="cover.xhtml">Cover</a></li><li><a href="copyright.xhtml">Copyright</a></li><li><a href="ch1.xhtml">Old Major</a></li><li><a href="ch2-3.xhtml#c2">The Rebellion</a></li><li><a href="ch2-3.xhtml#c3">The Harvest</a></li></ol></nav>`),
    "OEBPS/cover.xhtml": page(`<p>Cover picture</p>`),
    "OEBPS/copyright.xhtml": page(`<p>Copyright notice, all rights reserved.</p>`),
    "OEBPS/ch1.xhtml": page(`<section><header><h2>Old Major</h2></header>${prose("The meeting")}</section>`),
    "OEBPS/ch2-3.xhtml": page(`<section id="c2"><h2>The Rebellion</h2>${prose("The rebellion")}</section><section id="c3"><h2>The Harvest</h2>${prose("The harvest")}</section>`),
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
}

test("an EPUB chosen from the device goes into the Library as a book, every chapter at once", async ({ page }) => {
  const epub = { name: "the-farmyard.epub", mimeType: "application/epub+zip", buffer: await buildEpub() };
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(epub);
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.getByRole("status").filter({ hasText: "Added 3 chapters of The Farmyard" })).toBeVisible();
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  const text = page.getByRole("region", { name: "Document text" }).locator("article");
  await expect(text.getByRole("heading", { name: "Old Major" })).toBeVisible();
  await expect(text).toContainText("The meeting 4 went on");
  await expect(text).not.toContainText("Copyright");
  await expect(text).not.toContainText("The rebellion");

  await page.getByRole("link", { name: "Library", exact: true }).click();
  const book = page.locator('li[data-book="The Farmyard"]');
  await expect(book).toContainText("3 chapters");
  await book.getByRole("button", { name: "Show chapters of The Farmyard" }).click();
  const rows = page.getByRole("list", { name: "Chapters of The Farmyard" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("3. The Harvest");

  // The same book chosen again opens the shelved copy instead of adding it twice.
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(epub);
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.locator('li[data-book="The Farmyard"]')).toContainText("3 chapters");
});
