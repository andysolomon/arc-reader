import { test, expect } from "./fixtures";
import { composeAndListen, TEXT, composeText } from "./helpers";

test.describe("keyboard flow", () => {
  test("Compose → Listen → Space → → → [ → Esc", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "What should I read to you?" })).toBeVisible();

    // Listen via ⌘/Ctrl+Enter from inside the text area
    await composeText(page, TEXT);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForURL(/\/read\//);

    const player = page.getByRole("region", { name: "Player" });
    await expect(player).toBeVisible();
    const playPause = player.getByRole("button", { name: /^(Play|Pause)/ });

    // Playback started after the gesture; first sentence highlighted.
    await expect(playPause).toHaveAttribute("data-playing", "true");
    const article = page.locator("article");
    await expect(article.locator('[data-i="0"]')).toHaveClass(/bg-hl/);

    // Space pauses
    await page.keyboard.press("Space");
    await expect(playPause).toHaveAttribute("data-playing", "false");
    await expect(page.locator('[aria-live="polite"]').first()).toContainText("Paused");

    // → next sentence (and resumes reading from there)
    await page.keyboard.press("ArrowRight");
    await expect(article.locator('[data-i="1"]')).toHaveClass(/bg-hl/);
    await expect(article.locator('[data-i="0"]')).toHaveClass(/text-fg2/);

    // [ slows down by 0.25
    await page.keyboard.press("[");
    await expect(player.getByRole("button", { name: /^Speed 0\.75×/ })).toBeVisible();
    await page.keyboard.press("]");
    await expect(player.getByRole("button", { name: /^Speed 1×/ })).toBeVisible();

    // F enters focus mode (header and rail hidden), Esc exits
    await page.keyboard.press("f");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // ? opens the shortcuts dialog, Esc closes it
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

    // Shortcuts are ignored while typing
    await page.goto("/library");
    const search = page.getByLabel("Search library");
    await search.focus();
    await page.keyboard.type("?");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(search).toHaveValue("?");
  });

  test("clicking a sentence seeks and the scrubber is a keyboard slider", async ({ page }) => {
    await composeAndListen(page);
    await page.locator('article [data-i="3"]').click();
    await expect(page.locator('article [data-i="3"]')).toHaveClass(/bg-hl/);
    const slider = page.getByRole("slider", { name: "Progress" });
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(page.locator('article [data-i="0"]')).toHaveClass(/bg-hl/);
  });

  test("position persists and the library shows a progress ring", async ({ page }) => {
    await composeAndListen(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('article [data-i="2"]')).toHaveClass(/bg-hl/);
    await page.keyboard.press("Space"); // pause → persist now
    await expect(page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Play/ })).toHaveAttribute("data-playing", "false");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Library" }).click();
    const ring = page.getByRole("img", { name: /% listened/ }).first();
    await expect(ring).toHaveAttribute("aria-label", /^[1-9]\d*% listened$/);
    // A fresh page must restore the saved position, not just the in-memory player.
    await page.reload();
    await expect(ring).toHaveAttribute("aria-label", /^[1-9]\d*% listened$/);
  });

  test("speed chip cycles on tap and opens a slider on right-click", async ({ page }) => {
    await composeAndListen(page);
    const chip = page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Speed/ });
    await chip.click();
    await expect(chip).toHaveText("1.25×");
    await chip.click({ button: "right" });
    const range = page.getByRole("slider", { name: "Playback speed" });
    await expect(range).toBeVisible();
    await range.fill("2");
    await expect(chip).toHaveText("2×");
    await page.keyboard.press("Escape");
    await expect(range).toBeHidden();
  });
});
