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

/** Open the collapsible text box on Compose (the link field comes first) and fill it. */
export async function composeText(page: Page, text: string) {
  const toggle = page.getByRole("button", { name: "Type or paste text" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByLabel("Text to read").fill(text);
}

/** Compose → Listen with real text. Returns once the Reader is showing. A phone opens on the Library, so Compose is asked for by name. */
export async function composeAndListen(page: Page) {
  await page.goto("/compose");
  await composeText(page, TEXT);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await page.getByRole("region", { name: "Player" }).waitFor();
}
