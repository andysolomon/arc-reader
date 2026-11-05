import type { Page } from "@playwright/test";

export const THEMES = ["dark", "light", "tokyo-night", "catppuccin", "gruvbox", "nord", "everforest", "kanagawa"] as const;
export type Theme = (typeof THEMES)[number];

export const TEXT =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! How vexingly quick daft zebras jump? Sphinx of black quartz, judge my vow.\n\nA second paragraph keeps the reader honest. It has two sentences.";

export async function setTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    const raw = localStorage.getItem("readaloud:settings");
    const cur = raw ? JSON.parse(raw) : { state: {}, version: 1 };
    cur.state = { ...cur.state, theme: t };
    localStorage.setItem("readaloud:settings", JSON.stringify(cur));
  }, theme);
}

/** Compose → Listen with real text. Returns once the Reader is showing. */
export async function composeAndListen(page: Page) {
  await page.goto("/");
  await page.getByLabel("Text to read").fill(TEXT);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await page.getByRole("region", { name: "Player" }).waitFor();
}
