import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { THEMES, composeAndListen, setTheme } from "./helpers";

const SCREENS: { name: string; path: string }[] = [
  { name: "compose", path: "/" },
  { name: "library", path: "/library" },
  { name: "voices", path: "/voices" },
  { name: "settings", path: "/settings" },
  { name: "linux", path: "/linux" },
  { name: "auth", path: "/auth" },
];

for (const theme of THEMES) {
  test.describe(`axe · ${theme}`, () => {
    test.beforeEach(async ({ page }) => setTheme(page, theme));

    for (const s of SCREENS) {
      test(`${s.name}`, async ({ page }) => {
        await page.goto(s.path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
      });
    }

    test("reader with summary", async ({ page }) => {
      await composeAndListen(page);
      await page.keyboard.press("Space"); // paused: stable DOM for the scan
      await page.getByRole("button", { name: "Summarize" }).click();
      await expect(page.getByRole("region", { name: "Summary" })).toContainText("A stub summary of the main point.");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
      // Reading the summary aloud swaps the text and shows a way back.
      await page.getByRole("region", { name: "Summary" }).getByRole("button", { name: "Listen" }).click();
      await page.getByRole("button", { name: "Read the full article" }).waitFor();
      await page.keyboard.press("Space");
      const reading = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(reading.violations, JSON.stringify(reading.violations, null, 2)).toEqual([]);
    });

    test("reader with player and menu", async ({ page }) => {
      await composeAndListen(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.keyboard.press("Space"); // paused: stable DOM for the scan
      await page.getByRole("button", { name: "More" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  });
}
