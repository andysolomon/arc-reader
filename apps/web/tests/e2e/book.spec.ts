import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { buildEpub } from "../fixtures/epub";

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

  // Preparing the book reports how much of the whole is ready, not only each chapter.
  await book.getByRole("button", { name: "Prepare audio for Backend Basics" }).click();
  const prepare = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await prepare.getByRole("button", { name: /^Prepare \d+ readings?$/ }).click();
  const queue = page.getByRole("region", { name: "Audio preparation queue" });
  await expect(queue.getByRole("list", { name: "Books being prepared" })).toContainText(/Backend Basics.*\d+% of the book · \d of 3 chapters/);
  await expect(queue).toBeHidden({ timeout: 30_000 });
  await expect(book.getByRole("group", { name: "Audio made" })).toContainText("100% · 3/3");
  await expect(book.getByRole("group", { name: "Audio made" }).locator("[title]").first()).toHaveAttribute("title", /: 100% of the book · 3 of 3 chapters prepared$/);

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

test("a link to an EPUB is read as the book, with the rest of its chapters on offer", async ({ page }) => {
  const link = "https://books.example/releases/latest/download/the-farmyard.epub";
  const epub = await buildEpub();
  // Sent as a plain download, the way release files are.
  await page.route("https://books.example/**", (route) => route.fulfill({ contentType: "application/octet-stream", headers: { "access-control-allow-origin": "*", "content-disposition": "attachment; filename=the-farmyard.epub" }, body: epub }));
  await readLink(page, link);
  const offer = page.getByRole("complementary", { name: "Book" });
  await expect(offer).toContainText("This is chapter 1 of 3 in The Farmyard");
  const text = page.getByRole("region", { name: "Document text" }).locator("article");
  await expect(text.getByRole("heading", { name: "Old Major" })).toBeVisible();
  await expect(text).toContainText("The meeting 4 went on");
  await expect(text).not.toContainText("Copyright");

  await offer.getByRole("button", { name: "Add the other 2 chapters" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 chapters of The Farmyard" })).toBeVisible();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const book = page.locator('li[data-book="The Farmyard"]');
  await expect(book).toContainText("3 chapters");
  await book.getByRole("button", { name: "Show chapters of The Farmyard" }).click();
  const rows = page.getByRole("list", { name: "Chapters of The Farmyard" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("3. The Harvest");
});

test("an EPUB chosen from the device goes into the Library as a book, every chapter at once", async ({ page }) => {
  const epub = { name: "the-farmyard.epub", mimeType: "application/epub+zip", buffer: await buildEpub() };
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(epub);
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.getByRole("status").filter({ hasText: "Added 3 chapters of The Farmyard" })).toBeVisible();
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  // Uploading a book is not asking to listen: it opens paused.
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.locator('li[data-book="The Farmyard"]')).toContainText("3 chapters");
});

test("volumes of one work are kept together as a series, and reading runs on from one into the next", async ({ page }) => {
  const volumes = [
    { name: "farmyard-vol1.epub", mimeType: "application/epub+zip", buffer: await buildEpub({ subtitle: "Volume 1 — Spring", chapters: ["Old Major", "The Rebellion", "The Harvest"] }) },
    { name: "farmyard-vol2.epub", mimeType: "application/epub+zip", buffer: await buildEpub({ subtitle: "Volume 2 — Winter", chapters: ["Snowball", "The Windmill", "The Storm"] }) },
  ];
  // The later volume goes in first: the series still lists them in order.
  for (const [n, file] of [[2, volumes[1]], [1, volumes[0]]] as const) {
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByRole("status").filter({ hasText: `Added 3 chapters of The Farmyard: Volume ${n}` })).toBeVisible();
  }

  await page.getByRole("link", { name: "Library", exact: true }).click();
  const series = page.locator('li[data-series="The Farmyard"]');
  await expect(series).toContainText("2 volumes");
  await expect(series).toContainText("6 chapters");
  await expect(page.locator("li[data-book]")).toHaveCount(0);
  await series.getByRole("button", { name: "Show volumes of The Farmyard" }).click();
  const books = page.getByRole("list", { name: "Volumes of The Farmyard" }).locator("li[data-book]");
  await expect(books).toHaveCount(2);
  await expect(books.nth(0)).toContainText("Volume 1 — Spring");
  await expect(books.nth(1)).toContainText("Volume 2 — Winter");
  await books.nth(0).getByRole("button", { name: /^Show chapters of/ }).click();
  await expect(books.nth(0).getByRole("listitem")).toHaveCount(3);

  // The last chapter of the first volume leads into the first of the second.
  await books.nth(0).getByRole("listitem").nth(2).getByText("The Harvest").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  const next = page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /Next volume · Chapter 1/ });
  await expect(next).toContainText("Snowball");
  await next.click();
  await expect(page.getByRole("region", { name: "Document text" }).locator("article").getByRole("heading", { name: "Snowball" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /Previous volume · Chapter 3/ })).toContainText("The Harvest");
});
