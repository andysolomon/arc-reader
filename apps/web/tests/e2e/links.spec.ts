import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { composeText, setTheme } from "./helpers";

const axe = async (page: import("@playwright/test").Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
};

const LINKED =
  "Start with the guide at https://docs.python.org/guide before anything else. A second sentence gives the reader a moment. A third one keeps the voice busy for a while longer. The last sentence cites https://arxiv.org/paper for the curious.";

async function listen(page: import("@playwright/test").Page) {
  // A phone opens on the Library, so Compose is asked for by name.
  await page.goto("/compose");
  await composeText(page, LINKED);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await page.getByRole("region", { name: "Player" }).waitFor();
}

test("shows a link once it has been read and lists every link from the start", async ({ page }) => {
  await listen(page);
  // The first sentence is read; its link appears as a toast that opens the address.
  const toast = page.getByRole("status").getByRole("link", { name: /docs\.python\.org\/guide/ });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Space"); // pause before the last sentence
  await expect(toast).toHaveAttribute("href", "https://docs.python.org/guide");
  await axe(page);

  await page.getByRole("button", { name: "Links", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Links" });
  // Every link in the document is listed, with the ones already read marked.
  await expect(panel).toContainText("2 links · 1 read");
  const rows = panel.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole("link")).toHaveAttribute("href", "https://docs.python.org/guide");
  await expect(rows.nth(0)).toContainText("docs.python.org");
  await expect(rows.nth(0).getByLabel("Read")).toBeVisible();
  await expect(rows.nth(1)).toContainText("Not read yet");
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", "https://arxiv.org/paper");
  await axe(page);

  // Jumping past a link lists it without announcing it.
  await page.locator("article [data-i='3']").click();
  await page.keyboard.press("Space");
  await page.locator("article [data-i='1']").click();
  await page.keyboard.press("Space");
  await expect(panel).toContainText("2 links · 1 read");
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
  // Links not read yet are listed too.
  await expect(sheet.getByRole("table").locator("tbody tr")).toHaveCount(2);
  // The text behind the sheet overflows a phone screen: its scroll area must take keyboard focus.
  await axe(page);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  const text = page.getByRole("region", { name: "Document text" });
  await text.focus();
  await expect(text).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect.poll(() => text.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});
