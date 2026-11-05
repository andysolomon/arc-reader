import { test, expect } from "@playwright/test";
import { composeAndListen } from "./helpers";

test("phone: tab bar, compact bottom player, text controls in a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await composeAndListen(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box!.y).toBeGreaterThan(700); // bottom tab bar
  await expect(page.getByRole("region", { name: "Player" })).toBeVisible();
  await page.getByRole("button", { name: "Text settings" }).click();
  await expect(page.getByRole("dialog", { name: "Text" })).toBeVisible();
});

test("tablet: collapsed rail and floating pill", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await composeAndListen(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  const box = await nav.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(64);
  const player = page.getByRole("region", { name: "Player" });
  const pb = await player.boundingBox();
  expect(pb!.height).toBeCloseTo(64, 0);
});

test("desktop: 216px rail and a 760px capsule", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await composeAndListen(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  const box = await nav.boundingBox();
  expect(box!.width).toBe(216);
  const pb = await page.getByRole("region", { name: "Player" }).boundingBox();
  expect(pb!.width).toBe(760);
});

test.describe("touch phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fields are at least 16px so iOS doesn't zoom on focus", async ({ page }) => {
    for (const path of ["/library", "/voices", "/studio", "/settings", "/auth"]) {
      await page.goto(path);
      await page.locator("input, select, textarea").first().waitFor();
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
          .filter((el) => !["checkbox", "radio", "range", "file", "hidden"].includes(el.type))
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => el.getAttribute("aria-label") || el.placeholder || el.tagName),
      );
      expect(small, path).toEqual([]);
    }
  });

  test("library rows keep their actions hidden until swiped", async ({ page }) => {
    await composeAndListen(page);
    await page.goto("/library");
    const title = page.locator("li").first().getByRole("button").first();
    const del = page.locator("li [aria-label=Delete]").first();
    const t = (await title.boundingBox())!;
    const d = (await del.boundingBox())!;
    // The swipe panel sits under the row, so the row covers the delete button until swiped.
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[aria-label=Delete]"), { x: d.x + d.width / 2, y: d.y + d.height / 2 })).toBeNull();
    expect(t.width).toBeGreaterThan(200);
  });
});
