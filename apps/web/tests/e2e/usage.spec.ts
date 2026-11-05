import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

const today = new Date();
const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const previousMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
const row = { day: `${month}-01`, provider: "openai", model: "gpt-4o-mini-tts", requests: 2, characters: 800,
  bytes: 800, audioSeconds: 30, inputTokens: 200, outputTokens: 600, costUsd: 0.00732,
  pricing: "$0.60 / 1M input tokens + $12 / 1M audio output tokens", legacy: false };

test("usage has an honest empty state and links to real accounts", async ({ page }) => {
  await page.goto("/settings");
  const usage = page.getByRole("region", { name: "API usage and spending" });
  await expect(usage.getByText(/No speech usage recorded/)).toBeVisible();
  await expect(usage.getByRole("link", { name: "OpenAI usage dashboard" })).toHaveAttribute("href", "https://platform.openai.com/usage");
  await expect(usage.getByRole("link", { name: "Fish Audio account" })).toHaveAttribute("href", "https://fish.audio/");
  await expect(usage.getByText("Not configured", { exact: true })).toBeVisible();
});

test("monthly provider totals persist, preserve disconnected providers, and fit on mobile", async ({ page }) => {
  await page.goto("/settings");
  await page.evaluate(({ row, previousMonth }) => {
    localStorage.setItem("readaloud:usage", JSON.stringify({ version: 2, rows: [row,
      { ...row, provider: "fish", model: "s2.1-pro", requests: 1, characters: 4, bytes: 10, inputTokens: null, outputTokens: null, costUsd: 0.00015, pricing: "$15 / 1M UTF-8 bytes" },
      { ...row, day: `${previousMonth}-02`, costUsd: 1.25 },
    ] }));
  }, { row, previousMonth });
  await page.reload();
  const usage = page.getByRole("region", { name: "API usage and spending" });
  await expect(usage.getByText("$0.0075", { exact: true })).toBeVisible();
  await expect(usage.getByText("200 input · 600 audio output")).toBeVisible();
  await expect(page.locator('[data-provider-usage="fish"]').getByText("10 UTF-8 bytes")).toBeVisible();
  await expect(page.locator('[data-provider-usage="fish"]').getByText("Historical usage")).toBeVisible();
  await expect(usage.getByRole("img", { name: /Daily estimated spend/ })).toBeVisible();
  await usage.getByLabel("Usage month").selectOption(previousMonth);
  await expect(usage.getByText("$1.25", { exact: true })).toBeVisible();
  await usage.getByLabel("Usage month").selectOption(month);
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await usage.evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  const result = await new AxeBuilder({ page }).include('[aria-label="API usage and spending"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
});

test("old character counts remain visible without fabricated spend or tokens", async ({ page }) => {
  await page.goto("/settings");
  await page.evaluate((month) => localStorage.setItem("readaloud:usage", JSON.stringify({ month, chars: 1200, byEngine: { openai: 1200 } })), month);
  await page.reload();
  const usage = page.getByRole("region", { name: "API usage and spending" });
  await expect(usage.getByText("Estimated spend · partial")).toBeVisible();
  await expect(usage.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(page.locator('[data-provider-usage="openai"]').getByText("1,200 characters")).toBeVisible();
  await expect(usage.getByText(/Only character counts were recorded/)).toBeVisible();
});

test("settings updates when usage changes in another tab", async ({ page, context }) => {
  await page.goto("/settings");
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate((row) => localStorage.setItem("readaloud:usage", JSON.stringify({ version: 2, rows: [row] })), row);
  await expect(page.getByRole("region", { name: "API usage and spending" }).getByText("200 input · 600 audio output")).toBeVisible();
  await other.close();
});
