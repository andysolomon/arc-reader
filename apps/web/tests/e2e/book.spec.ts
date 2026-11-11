import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
};

const SITE = "https://book.example";
const CHAPTERS = [
  ["01-http", "HTTP & CORS", "<h2>Why HTTP</h2><p>It carries every request and every response.</p>"],
  ["02-routing", "Routing", `<h2>Static routes</h2><p>A route names a resource on the server. The router matches each request to one.</p>
    <aside class="callout"><p>Mental model</p><p>Methods say what, routes say where.</p></aside>
    <table><thead><tr><th>Part</th><th>Meaning</th></tr></thead><tbody><tr><td>Path</td><td>Which resource</td></tr></tbody></table>
    <h3>Dynamic routes</h3><p>A parameter stands in for part of the path. That keeps one route for every user.</p>`],
  ["03-databases", "Databases", "<h2>Why databases exist</h2><p>They persist data across sessions. Disk is roomy and cheap.</p>"],
];
const nav = `<nav aria-label="All chapters"><a href="/">Overview</a><ol>${CHAPTERS.map(([slug, title], i) => `<li><a href="/${slug}/"><span>0${i + 1}</span><span>${title}</span></a></li>`).join("")}</ol></nav>`;
const pages: Record<string, string> = {
  "/": `<title>Backend Basics — a three-chapter reference</title>${nav}<main><h1>Backend Basics</h1><p>Every chapter is a field manual for one part of the backend.</p></main>`,
  ...Object.fromEntries(CHAPTERS.map(([slug, title, body], i) => [`/${slug}/`, `<title>${title} · Chapter 0${i + 1} · Backend Basics</title>${nav}<main><article>${body}</article></main>`])),
};

/** The book's site, readable straight from the browser. */
async function serveBook(page: Page) {
  await page.route(`${SITE}/**`, (route) => {
    const html = pages[new URL(route.request().url()).pathname];
    return html ? route.fulfill({ contentType: "text/html; charset=utf-8", headers: { "access-control-allow-origin": "*" }, body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>` }) : route.fulfill({ status: 404, body: "Not found" });
  });
}

async function readLink(page: Page, url: string) {
  await page.goto("/");
  await page.getByLabel("Link to read").fill(url);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
}

test("a contents page becomes a book read chapter by chapter", async ({ page }) => {
  await serveBook(page);
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
  await serveBook(page);
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
