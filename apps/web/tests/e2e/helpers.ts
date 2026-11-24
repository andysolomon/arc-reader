import { expect, type Page } from "@playwright/test";

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

/** Ask the player to prepare the open reading. Opening a reading never prepares it by itself. */
export async function prepareFromPlayer(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Prepare audio", exact: true }).click();
}

/** The Library keeps its sort order and its list or cards view behind one icon. */
export async function libraryOption(page: Page, name: "Newest first" | "Shortest first" | "Longest first" | "List" | "Cards") {
  await page.getByRole("button", { name: "Sort and view", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

/** Put documents straight into the browser's library, one per voice ("First document", "Second document", …), and show the Library. */
export async function seedLibrary(page: Page, voiceIds: (string | null)[] = [null, null]) {
  await page.goto("/library");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.evaluate(async (voices) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("readaloud");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("docs", "readwrite");
      for (const [index, voice] of voices.entries()) {
        const id = ["First", "Second", "Third", "Fourth"][index] ?? `Extra ${index + 1}`;
        tx.objectStore("docs").put({
          id, title: `${id} document`, text: `${id} paragraph.\n\nMore ${id.toLowerCase()} text.`, voice,
          source: "paste", domain: "Pasted text", chars: 40, createdAt: 1, updatedAt: 1,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  }, voiceIds);
  await page.reload();
  await expect(page.locator('[data-screen="library"] li').getByRole("button", { name: / document$/ })).toHaveCount(voiceIds.length);
}
