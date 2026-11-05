import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function legacyLibrary(page: Page, id: string) {
  // Same origin, before the app loads: reproduce a pre-sync v1 browser library.
  await page.goto("/icons/icon.svg");
  await page.evaluate(async (id) => {
    const d = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("readaloud", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("docs", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        request.result.createObjectStore("positions", { keyPath: "docId" });
        request.result.createObjectStore("audio", { keyPath: "key" }).createIndex("createdAt", "createdAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = d.transaction(["docs", "positions"], "readwrite");
    tx.objectStore("docs").put({ id, title: id, text: "First sentence. Second sentence.", source: "paste", domain: "Pasted text", voice: "local", chars: 32, createdAt: 1, updatedAt: 1 });
    tx.objectStore("positions").put({ docId: id, index: 1, offset: 0, fraction: 0.5, total: 10, updatedAt: 1 });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    d.close();
  }, id);
}

test("independent browsers merge legacy libraries, open shared links, and sync offline deletions", async ({ page, browser, baseURL, request }) => {
  const first = `shared-a-${randomUUID()}`, second = `shared-b-${randomUUID()}`;
  const other = await browser.newContext({ baseURL });
  const secondPage = await other.newPage();
  try {
    await legacyLibrary(page, first);
    await page.goto("/library");
    await expect(page.getByText("Shared library · Synced", { exact: true })).toBeVisible();
    await legacyLibrary(secondPage, second);
    await secondPage.goto(`/read/${first}`);
    await expect(secondPage.locator("article")).toContainText("Second sentence.");
    await secondPage.getByRole("link", { name: "Library", exact: true }).click();
    await expect(secondPage.getByRole("button", { name: first, exact: true })).toBeVisible();
    await expect(secondPage.getByRole("button", { name: second, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: second, exact: true })).toBeVisible({ timeout: 15_000 });
    const progress = await page.evaluate(async (id) => {
      const d = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("readaloud"); r.onsuccess = () => resolve(r.result); });
      const value = await new Promise<{ fraction: number }>((resolve) => { const r = d.transaction("positions").objectStore("positions").get(id); r.onsuccess = () => resolve(r.result); });
      d.close(); return value.fraction;
    }, second);
    expect(progress).toBe(0.5);
    await other.setOffline(true);
    await secondPage.getByRole("button", { name: "Cards", exact: true }).click();
    const item = secondPage.getByRole("listitem").filter({ has: secondPage.getByRole("button", { name: first, exact: true }) });
    await item.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(secondPage.getByRole("button", { name: first, exact: true })).toHaveCount(0);
    await expect(secondPage.getByText("Saved on this device · Waiting to sync", { exact: true })).toBeVisible();
    await other.setOffline(false);
    await expect(secondPage.getByText("Shared library · Synced", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: first, exact: true })).toHaveCount(0, { timeout: 15_000 });
    await secondPage.reload();
    await expect(secondPage.getByRole("button", { name: second, exact: true })).toBeVisible();
    await expect(secondPage.getByRole("button", { name: first, exact: true })).toHaveCount(0);
  } finally {
    await other.close();
    await request.post("/api/library/sync", { data: { changes: [{ kind: "delete", docId: first }, { kind: "delete", docId: second }] } });
  }
});
