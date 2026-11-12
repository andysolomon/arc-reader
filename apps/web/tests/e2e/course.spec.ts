import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { buildPdf } from "../fixtures/pdf";

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
};

const COURSE = "https://cs101.school.example/";
const SLIDES = "https://web.school.example/class/cs101/slides";
const LECTURES = ["Introduction to Systems", "Models for Builders", "Retrieval", "Tools"];

/** The course page as it stands once `posted` lectures have slides: a schedule whose links only say "Slides". */
const schedule = (posted: number) => `<!doctype html><html><head><meta charset="utf-8"><title>CS101 | Building Things</title></head><body>
  <h1>CS 101: Building Things</h1><p>Welcome to the course. Lecture materials are linked here as they are released.</p>
  <table><thead><tr><th>Week</th><th>Date</th><th>Lecture</th></tr></thead><tbody>${LECTURES.map((title, i) => `<tr><td>${i + 1}</td><td>Mon Sep ${21 + i}</td>
    <td><span class="lec-title">${title}</span><span class="lec-desc">What this lecture covers.</span>${i < posted ? `<a href="${SLIDES}/lecture0${i + 1}.pdf">Slides</a>` : ""}</td></tr>`).join("")}
  </tbody></table></body></html>`;

const deck = (n: number) => buildPdf([
  `BT /F1 60 Tf 150 260 Td (Deck ${n}) Tj ET BT /F1 30 Tf 150 180 Td (CS 101) Tj ET`,
  `BT /F1 40 Tf 50 450 Td (Topic ${n}) Tj ET BT /F1 24 Tf 50 300 Td (Lecture ${n} makes a point long enough to be read aloud) Tj ET`,
]);

/** The course's site: its page readable from the browser, its decks only through the server, which is handed the files. */
async function serveCourse(page: Page, posted: { count: number }) {
  await page.route(COURSE, (route) => route.fulfill({ contentType: "text/html; charset=utf-8", headers: { "access-control-allow-origin": "*" }, body: schedule(posted.count) }));
  await page.route(`${SLIDES}/**`, (route) => route.abort());
  await page.route("**/api/fetch?url=*", async (route) => {
    const target = new URL(route.request().url()).searchParams.get("url") ?? "";
    const n = Number(target.match(/lecture0(\d)\.pdf$/)?.[1]);
    if (!n) return route.fallback();
    const read = await page.request.post(`/api/fetch/pdf?name=lecture0${n}.pdf`, { data: deck(n), headers: { "content-type": "application/pdf" } });
    await route.fulfill({ status: read.status(), contentType: "text/html; charset=utf-8", body: await read.text() });
  });
}

test("a course page becomes a shelf of its lectures, and takes new ones as they are posted", async ({ page }) => {
  const posted = { count: 3 };
  await serveCourse(page, posted);
  await page.goto("/");
  await page.getByLabel("Link to read").fill(COURSE);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  const offer = page.getByRole("complementary", { name: "Book" });
  await expect(offer).toContainText("This page lists the 3 lectures of CS 101: Building Things");
  await expect(offer).toContainText("Add them to listen to the course in order.");
  await axe(page);

  await offer.getByRole("button", { name: "Add 3 lectures" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 3 lectures of CS 101: Building Things" })).toBeVisible({ timeout: 30_000 });
  // The first deck takes the course page's place, named by the schedule rather than by "Slides" or its own title slide.
  await expect(page.getByText("Lecture 1 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Introduction to Systems" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Topic 1" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Lectures" }).getByRole("button", { name: /Next · Lecture 2\s*Models for Builders/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Pause" }).isVisible()) await page.keyboard.press("Space");

  await page.getByRole("link", { name: "Library", exact: true }).click();
  const course = page.locator('li[data-book="CS 101: Building Things"]');
  await expect(course).toContainText("Course");
  await expect(course).toContainText("3 lectures");
  await course.getByRole("button", { name: "Show lectures of CS 101: Building Things" }).click();
  const rows = page.getByRole("list", { name: "Lectures of CS 101: Building Things" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("3. Retrieval");
  await axe(page);

  // Nothing new yet; then the fourth lecture's slides are posted.
  await course.getByRole("button", { name: "Check for new lectures" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No new lectures have been posted" })).toBeVisible();
  posted.count = 4;
  await course.getByRole("button", { name: "Check for new lectures" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 1 lecture of CS 101: Building Things" })).toBeVisible({ timeout: 30_000 });
  await expect(course).toContainText("4 lectures");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("4. Tools");
});
