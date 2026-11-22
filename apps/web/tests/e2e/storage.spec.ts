import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

/**
 * Save clips of the given sizes straight into this browser's audio store, as earlier listening would have.
 * With `recorded`, each clip is small but recorded as that many bytes, standing in for gigabytes of audio.
 */
const saveAudio = (page: Page, sizes: number[], recorded?: number[]) => page.evaluate(async ([sizes, recorded]) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("readaloud");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction("audio", "readwrite");
  sizes.forEach((bytes, i) => tx.objectStore("audio").put({ key: `kitten|test|${i}`, blob: new Blob([new Uint8Array(bytes)]), mime: "audio/mpeg", duration: 1, createdAt: i + 1, bytes: recorded?.[i] ?? bytes }));
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}, [sizes, recorded] as const);

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
  await expect(storage.getByText("Nothing saved yet.", { exact: true })).toBeVisible();
  await expect(storage.getByRole("button", { name: "Remove" })).toBeDisabled();
  await expect(storage.getByText("Documents, audio, settings and the app itself. This browser allows up to 18 GB.")).toBeVisible();
  await expect(storage.getByText("200 MB", { exact: true })).toBeVisible();

  await saveAudio(page, [3 * 1024 ** 2, 2 * 1024 ** 2]);
  await page.reload();
  await expect(storage.getByText("2 passages saved to replay and to listen offline.", { exact: true })).toBeVisible();
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

test("storage keeps as much audio as chosen, up to half of what the browser allows", async ({ page }) => {
  await browserStorage(page, true);
  await page.goto("/settings");
  const storage = page.getByRole("region", { name: "Storage" });
  await expect(storage.getByText("Past this, the oldest audio is removed first. Max is half of what this browser allows: 9 GB.")).toBeVisible();
  const keep = storage.getByRole("radiogroup", { name: "Downloaded audio to keep" });
  // 10 and 20 GB would be more than the 9 GB allowed, so they aren't offered.
  await expect(keep.getByRole("radio")).toHaveText(["1 GB", "2 GB", "5 GB", "Max"]);
  await expect(keep.getByRole("radio", { name: "1 GB" })).toHaveAttribute("aria-checked", "true");

  // Nothing is saved, so a larger or smaller amount needs no confirmation and stays chosen.
  await keep.getByRole("radio", { name: "5 GB" }).click();
  await expect(keep.getByRole("radio", { name: "5 GB" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(keep.getByRole("radio", { name: "5 GB" })).toHaveAttribute("aria-checked", "true");
  await keep.getByRole("radio", { name: "Max" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(keep.getByRole("radio", { name: "Max" })).toHaveAttribute("aria-checked", "true");

  // 3 GB saved: keeping 2 GB asks first, then removes the oldest down to just under it.
  await saveAudio(page, [1, 1, 1], [1024 ** 3, 1024 ** 3, 1024 ** 3]);
  await page.reload();
  await expect(storage.getByText("3 GB", { exact: true })).toBeVisible();
  await keep.getByRole("radio", { name: "2 GB" }).click();
  const dialog = page.getByRole("dialog", { name: "Keep up to 2 GB?" });
  await expect(dialog.getByText(/The oldest 1.2 GB of downloaded audio is removed from this device to fit/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(keep.getByRole("radio", { name: "Max" })).toHaveAttribute("aria-checked", "true");
  await expect(storage.getByText("3 GB", { exact: true })).toBeVisible();

  await keep.getByRole("radio", { name: "2 GB" }).click();
  await dialog.getByRole("button", { name: "Remove older audio" }).click();
  await expect(page.getByText("Removed 2 older audio clips to stay under 2 GB")).toBeVisible();
  await expect(keep.getByRole("radio", { name: "2 GB" })).toHaveAttribute("aria-checked", "true");
  await expect(storage.getByText("1 passage saved to replay and to listen offline.", { exact: true })).toBeVisible();
  await expect(storage.locator("span").getByText("1 GB", { exact: true })).toBeVisible();
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
