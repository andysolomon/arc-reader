import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
};

/** The course page, from tests/stub-site.mjs: the app server fetches its decks itself, so the browser can't fake them. */
const SITE = `http://127.0.0.1:${process.env.E2E_SITE_PORT || 3996}`;
const COURSE = `${SITE}/cs101/`;
const post = (page: Page, count: number) => page.request.post(`${SITE}/cs101/posted?count=${count}`);

test("a course page becomes a shelf of its lectures, and takes new ones as they are posted", async ({ page }) => {
  await post(page, 3);
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
  // Opening the Library syncs it, and "Sync now" is dimmed meanwhile.
  await expect(page.getByRole("status", { name: "Library sync" })).toContainText("Synced");
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
  await axe(page);

  // Nothing new yet; then the fourth lecture's slides are posted.
  await course.getByRole("button", { name: "Check for new lectures" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No new lectures have been posted" })).toBeVisible();
  await post(page, 4);
  await course.getByRole("button", { name: "Check for new lectures" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 1 lecture of CS 101: Building Things" })).toBeVisible({ timeout: 30_000 });
  await expect(course).toContainText("4 lectures");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("4. Tools");
});
