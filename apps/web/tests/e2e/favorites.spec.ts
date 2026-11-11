import { test, expect } from "./fixtures";
import { composeAndListen } from "./helpers";

test("favorites a document, estimates a premium read, and has Jev judge it", async ({ page }) => {
  await composeAndListen(page);
  await page.keyboard.press("Space"); // pause
  await page.goto("/library");
  const row = page.getByRole("listitem").filter({ hasText: "quick brown fox" });
  await row.hover();
  await row.getByRole("button", { name: "Favorite" }).click();
  await expect(row.getByRole("button", { name: "Favorite" })).toHaveAttribute("aria-pressed", "true");
  // Jev (stubbed) answers its last choice.
  await expect(row).toContainText("Free voice is fine");
  await expect(row.getByLabel(/Premium read about \$/)).toBeVisible();

  const favorites = page.getByRole("group", { name: "Filter by favorites" });
  await expect(page.getByLabel("Premium read estimate for all favorites")).toContainText(/Fish Audio ≈\$\d/);
  await favorites.getByRole("button", { name: /Favorites/ }).click();
  await expect(page.getByRole("button", { name: /quick brown fox/ })).toBeVisible();

  await page.getByRole("button", { name: /quick brown fox/ }).click();
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("region", { name: "Details" });
  const estimates = details.getByRole("list", { name: "Premium read estimates" });
  await expect(estimates.getByRole("listitem")).toHaveCount(3);
  await expect(estimates).toContainText("OpenAI's published $0.015 a minute");
  await expect(details).toContainText("Jev: Free voice is fine · 74% confident.");

  // Unfavoriting syncs too, and the Library's favorites filter goes away with the last favorite.
  await details.getByRole("button", { name: "Favorited" }).click();
  await expect(details).toContainText("Favorite this to estimate a premium read");
  await page.goto("/library");
  await expect(page.getByRole("group", { name: "Filter by favorites" })).toHaveCount(0);
});
