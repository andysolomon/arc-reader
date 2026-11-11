import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { composeText, setTheme } from "./helpers";

const axe = async (page: import("@playwright/test").Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
};

const LINKED =
  "Start with the guide at https://example.com/guide before anything else. A second sentence gives the reader a moment. A third one keeps the voice busy for a while longer. The last sentence cites https://example.org/paper for the curious.";

async function listen(page: import("@playwright/test").Page) {
  await page.goto("/");
  await composeText(page, LINKED);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await page.getByRole("region", { name: "Player" }).waitFor();
}

test("shows a link once it has been read and adds it to the Links table", async ({ page }) => {
  await listen(page);
  // The first sentence is read; its link appears as a toast that opens the address.
  const toast = page.getByRole("status").getByRole("link", { name: /example\.com\/guide/ });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Space"); // pause before the last sentence
  await expect(toast).toHaveAttribute("href", "https://example.com/guide");
  await axe(page);

  await page.getByRole("button", { name: "Links", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Links" });
  await expect(panel.getByRole("radio", { name: "Read 1" })).toBeChecked();
  const rows = panel.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("link")).toHaveAttribute("href", "https://example.com/guide");
  await expect(rows.first()).toContainText("example.com");

  // Every link in the document, with the ones already read marked.
  await panel.getByRole("radio", { name: "All 2" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByLabel("Read")).toBeVisible();
  await expect(rows.nth(1)).toContainText("Not read yet");
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", "https://example.org/paper");
  await axe(page);

  // Jumping past a link lists it without announcing it.
  await page.locator("article [data-i='3']").click();
  await page.keyboard.press("Space");
  await page.locator("article [data-i='1']").click();
  await page.keyboard.press("Space");
  await expect(panel.getByRole("radio", { name: "Read 1" })).toBeVisible();
  await expect(page.getByRole("status").getByRole("link")).toHaveCount(0);

  await panel.getByRole("button", { name: "Hide links" }).click();
  await expect(panel).toBeHidden();
});

test("lists links in a sheet on a phone and can turn the toasts off", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await page.addInitScript(() => {
    const raw = localStorage.getItem("readaloud:settings");
    const cur = raw ? JSON.parse(raw) : { state: {}, version: 3 };
    cur.state = { ...cur.state, linkToasts: false };
    localStorage.setItem("readaloud:settings", JSON.stringify(cur));
  });
  await listen(page);
  await expect(page.locator("article [data-i='1']")).toHaveClass(/bg-hl/, { timeout: 30_000 });
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").getByRole("link")).toHaveCount(0);

  await page.getByRole("button", { name: "Links", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Links" });
  await expect(sheet.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await sheet.getByRole("radio", { name: "All 2" }).click();
  await expect(sheet.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
});
