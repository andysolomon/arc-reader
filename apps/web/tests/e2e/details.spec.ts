import { test, expect } from "./fixtures";
import { composeAndListen } from "./helpers";

test("files a new document with Jev, keeps edited details, and finds it by them in the Library", async ({ page }) => {
  await composeAndListen(page);
  await page.keyboard.press("Space"); // pause
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("region", { name: "Details" });
  // Jev (stubbed) files new documents in the background.
  await expect(details.getByLabel("Category")).toHaveValue("Personal writing");
  await expect(details).toContainText("Filed by Jev · 74% confident");

  await details.getByLabel("Link").fill("https://example.com/pangrams");
  await details.getByLabel("Link").press("Enter");
  await expect(details.getByRole("link", { name: "Open the original" })).toHaveAttribute("href", "https://example.com/pangrams");
  await details.getByLabel("Author").fill("Ada Lovelace");
  await details.getByLabel("Author").press("Enter");
  await details.getByLabel("Notes").fill("Every letter of the alphabet.");
  await details.getByLabel("Category").fill("Typography");
  await details.getByLabel("Category").press("Enter");
  await expect(details).toContainText("Chosen by you.");
  // Escape discards an edit.
  await details.getByLabel("Author").fill("Someone else");
  await details.getByLabel("Author").press("Escape");
  await expect(details.getByLabel("Author")).toHaveValue("Ada Lovelace");

  await page.reload();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(details.getByLabel("Category")).toHaveValue("Typography");
  await expect(details.getByLabel("Author")).toHaveValue("Ada Lovelace");
  await expect(details.getByLabel("Notes")).toHaveValue("Every letter of the alphabet.");

  await page.goto("/library");
  await page.getByRole("button", { name: "Filter by category" }).click();
  await expect(page.getByRole("menu", { name: "Filter by category" }).getByRole("menuitemradio", { name: /Typography/ })).toBeVisible();
  await page.keyboard.press("Escape");
  const search = page.getByLabel("Search library");
  await search.fill("lovelace");
  await expect(page.getByRole("button", { name: /quick brown fox/ })).toBeVisible();
  await search.fill("alphabet");
  await expect(page.getByRole("button", { name: /quick brown fox/ })).toBeVisible();
  await search.fill("no such thing");
  await expect(page.getByText("Nothing here matches.")).toBeVisible();
});

test("enters the TypeSafe key in Settings", async ({ page }) => {
  await page.goto("/settings");
  // The stub server starts with TYPESAFE_API_KEY set.
  await expect(page.getByText("Set on the server (TYPESAFE_API_KEY) · ends in -key")).toBeVisible();
  await page.getByRole("button", { name: "Replace TypeSafe key" }).click();
  const field = page.getByLabel("TypeSafe API key");
  await field.fill("wrong-key");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("TypeSafe didn't accept that key");
});
