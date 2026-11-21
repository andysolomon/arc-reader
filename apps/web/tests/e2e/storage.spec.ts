import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

/** Save clips of the given sizes straight into this browser's audio store, as earlier listening would have. */
const saveAudio = (page: Page, sizes: number[]) => page.evaluate(async (sizes) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("readaloud");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction("audio", "readwrite");
  sizes.forEach((bytes, i) => tx.objectStore("audio").put({ key: `kitten|test|${i}`, blob: new Blob([new Uint8Array(bytes)]), mime: "audio/mpeg", duration: 1, createdAt: i + 1, bytes }));
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}, sizes);

/** What the browser reports about this site's storage, and whether it agrees to keep it. */
const browserStorage = (page: Page, grants: boolean) => page.addInitScript((grants) => {
  let kept = false;
  Object.defineProperty(navigator, "storage", { configurable: true, value: {
    estimate: async () => ({ usage: 200 * 1024 ** 2, quota: 18 * 1024 ** 3 }),
    persisted: async () => kept,
    persist: async () => (kept = grants),
  } });
}, grants);

test("storage shows what is saved, the limit, and removes downloaded audio on request", async ({ page }) => {
  await browserStorage(page, true);
  await page.goto("/settings");
  const storage = page.getByRole("region", { name: "Storage" });
  await expect(storage.getByText("Nothing saved yet. Up to 1 GB is kept; the oldest is removed first.")).toBeVisible();
  await expect(storage.getByRole("button", { name: "Remove" })).toBeDisabled();
  await expect(storage.getByText("Documents, audio, settings and the app itself. This browser allows up to 18 GB.")).toBeVisible();
  await expect(storage.getByText("200 MB", { exact: true })).toBeVisible();

  await saveAudio(page, [3 * 1024 ** 2, 2 * 1024 ** 2]);
  await page.reload();
  await expect(storage.getByText("2 passages saved to replay and to listen offline. Up to 1 GB is kept; the oldest is removed first.")).toBeVisible();
  await expect(storage.getByText("5 MB", { exact: true })).toBeVisible();

  // Cancelling keeps the audio.
  await storage.getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove downloaded audio?" });
  await expect(dialog.getByText(/5 MB of saved audio is removed from this device/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(storage.getByText("5 MB", { exact: true })).toBeVisible();

  await storage.getByRole("button", { name: "Remove" }).click();
  await dialog.getByRole("button", { name: "Remove audio" }).click();
  await expect(page.getByText("Downloaded audio removed")).toBeVisible();
  await expect(storage.getByText(/Nothing saved yet/)).toBeVisible();
  await page.reload();
  await expect(storage.getByText(/Nothing saved yet/)).toBeVisible();
});

test("storage can be kept when the device runs low on space", async ({ page }) => {
  await browserStorage(page, true);
  await page.goto("/settings");
  const storage = page.getByRole("region", { name: "Storage" });
  await expect(storage.getByText(/Until this is on, the browser may clear what ReadAloud saved/)).toBeVisible();
  await storage.getByRole("button", { name: "Turn on" }).click();
  await expect(storage.getByText("The browser won’t clear what ReadAloud saved to free up space.")).toBeVisible();
  await expect(storage.getByRole("button", { name: "Turn on" })).toHaveCount(0);
});

test("a browser that declines says so, and the section fits a phone", async ({ page }) => {
  await browserStorage(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const storage = page.getByRole("region", { name: "Storage" });
  await storage.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/The browser didn't allow it/)).toBeVisible();
  await expect(storage.getByRole("button", { name: "Turn on" })).toBeVisible();
  const dimensions = await storage.evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  const result = await new AxeBuilder({ page }).include('[aria-label="Storage"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
});
