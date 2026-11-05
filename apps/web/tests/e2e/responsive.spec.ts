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
