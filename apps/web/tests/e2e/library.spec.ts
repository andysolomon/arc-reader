import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function seedLibrary(page: Page) {
  await page.goto("/library");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("readaloud", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("docs", "readwrite");
      for (const id of ["First", "Second"]) tx.objectStore("docs").put({
        id, title: `${id} document`, text: `${id} paragraph.\n\nMore ${id.toLowerCase()} text.`, voice: null,
        source: "paste", domain: "Pasted text", chars: 40, createdAt: 1, updatedAt: 1,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Select .* document/ })).toHaveCount(2);
}

test("prepares multiple documents in multiple voices, reuses saved audio, and shows persisted coverage in both views", async ({ page }) => {
  await seedLibrary(page);
  let requests = 0;
  page.on("request", (request) => { if (/\/api\/preparations\/[^/]+\/audio\//.test(request.url())) requests++; });
  await page.getByRole("checkbox", { name: "Select all", exact: true }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await expect(dialog.getByRole("checkbox", { name: "Bella VoiceStudio" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" }).check();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole("button", { name: "Prepare 4 readings" }).click();
  // Internal navigation keeps the preparation queue alive.
  await page.getByRole("link", { name: "Compose", exact: true }).click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("region", { name: "Audio preparation queue" })).toContainText("Audio preparation finished", { timeout: 15_000 });
  await expect(page.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Jasper: 100% prepared", exact: true })).toHaveCount(2);
  expect(requests).toBe(8);
  await expect(page.getByRole("region", { name: "Player", exact: true })).toBeHidden();

  await page.getByRole("checkbox", { name: "Select all", exact: true }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  await dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" }).check();
  await dialog.getByRole("button", { name: "Prepare 4 readings" }).click();
  await expect(page.getByRole("region", { name: "Audio preparation queue" })).toContainText("Audio preparation finished");
  expect(requests).toBe(8);

  await page.reload();
  await expect(page.getByRole("img", { name: "Jasper: 100% prepared", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await expect(page.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "0% listened", exact: true })).toHaveCount(2);
  const library = page.locator('[data-screen="library"]');
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("selects filtered documents and offers explicit paid voice preparation", async ({ page }) => {
  await seedLibrary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("textbox", { name: "Search library" }).fill("First");
  await page.getByRole("checkbox", { name: "Select visible" }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await expect(dialog).toContainText("First document");
  await dialog.getByRole("checkbox", { name: "Bella VoiceStudio" }).uncheck();
  await dialog.getByRole("textbox", { name: "Search preparation voices" }).fill("Alloy");
  await dialog.getByRole("checkbox", { name: "Alloy ChatGPT" }).check();
  await expect(dialog).toContainText("bill uncached audio for the full document");
  await dialog.getByRole("button", { name: "Prepare 1 reading", exact: true }).click();
  await expect(page.getByRole("img", { name: "Alloy: 100% prepared", exact: true })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search library" }).fill("");
  await expect(page.getByRole("img", { name: "Alloy: 100% prepared", exact: true })).toHaveCount(1);
  const library = page.locator('[data-screen="library"]');
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
