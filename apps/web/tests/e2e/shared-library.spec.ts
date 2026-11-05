import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { hash } from "../../src/lib/hash";

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

test("repairs a library that says Synced but has an unqueued local document", async ({ page, browser, baseURL, request }) => {
  const id = `unqueued-${randomUUID()}`;
  const other = await browser.newContext({ baseURL });
  try {
    await page.goto("/library");
    await expect(page.getByText("Shared library · Synced", { exact: true })).toBeVisible();
    await page.evaluate(async (id) => {
      const d = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("readaloud"); r.onsuccess = () => resolve(r.result); });
      const tx = d.transaction("docs", "readwrite");
      tx.objectStore("docs").put({ id, title: id, text: "A document only saved on this device.", source: "paste", domain: "Pasted text", voice: "local", chars: 36, createdAt: 1, updatedAt: 1 });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      d.close();
    }, id);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect.poll(async () => {
      const response = await request.post("/api/library/sync", { data: { changes: [] } });
      return (await response.json()).docs.some((record: { id: string }) => record.id === id);
    }).toBe(true);
    const otherPage = await other.newPage();
    await otherPage.goto("/library");
    await expect(otherPage.getByRole("button", { name: id, exact: true })).toBeVisible();
    await expect(otherPage.getByLabel("Synced document count")).toContainText(/\d+ documents?/);
  } finally {
    await other.close();
    await request.post("/api/library/sync", { data: { changes: [{ kind: "delete", docId: id }] } });
  }
});

test("a fresh device sees server audio and queue status without downloading or generating", async ({ browser, baseURL, request }) => {
  const id = `shared-audio-${randomUUID()}`;
  const text = `Shared audio ${id}.`;
  const voice = "expr-voice-2-f";
  // The stub exposes KittenTTS; use its built-in Bella voice ID.
  const keys = [`kittentts|${voice}|${hash(text)}`];
  const context = await browser.newContext({ baseURL });
  let jobId: string | undefined;
  try {
    await request.post("/api/library/sync", { data: { changes: [{ kind: "doc", record: { id, title: id, text, source: "paste", domain: "Text", voice: null, chars: text.length, createdAt: 1, updatedAt: 1 } }] } });
    const submitted = await request.post("/api/preparations", { data: { requests: [{ key: keys[0], text, voice, engine: "kittentts", protocol: "openai" }], start: 0 } });
    expect(submitted.status()).toBe(202);
    jobId = (await submitted.json()).id;
    await expect.poll(async () => (await (await request.get(`/api/preparations/${jobId}`)).json()).state).toBe("done");
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (r) => { if ((r.method() === "POST" && /\/(?:api\/preparations|audio\/speech|tts)$/.test(r.url())) || /\/api\/preparations\/[^/]+\/audio\/\d+/.test(r.url())) requests.push(r.url()); });
    await page.goto("/library");
    const item = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: id, exact: true }) });
    await expect(item.getByRole("img", { name: /100% prepared/ })).toBeVisible();
    // Other tests' documents share this server, so read this document's own row.
    const row = page.getByRole("region", { name: "Audio preparation queue" }).getByRole("listitem").filter({ hasText: id });
    await expect(row.getByText("Prepared on server", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    const downloaded = await page.evaluate(async () => {
      const d = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("readaloud"); r.onsuccess = () => resolve(r.result); });
      const count = await new Promise<number>((resolve) => { const r = d.transaction("audio").objectStore("audio").count(); r.onsuccess = () => resolve(r.result); });
      d.close(); return count;
    });
    expect(downloaded).toBe(0);
  } finally {
    await context.close();
    if (jobId) await request.delete(`/api/preparations/${jobId}`);
    await request.post("/api/library/sync", { data: { changes: [{ kind: "delete", docId: id }] } });
  }
});

test("shares a clip that previously existed only in one browser's cache", async ({ browser, baseURL, request }) => {
  const id = `device-audio-${randomUUID()}`;
  const text = `Existing audio ${id}.`;
  const voice = "expr-voice-2-f";
  const key = `kittentts|${voice}|${hash(text)}`;
  const source = await browser.newContext({ baseURL });
  const destination = await browser.newContext({ baseURL });
  let jobId: string | undefined;
  try {
    await request.post("/api/library/sync", { data: { changes: [{ kind: "doc", record: { id, title: id, text, source: "paste", domain: "Text", voice: null, chars: text.length, createdAt: 1, updatedAt: 1 } }] } });
    const submitted = await request.post("/api/preparations", { data: { requests: [{ key, text, voice, engine: "kittentts", protocol: "openai", cached: true }], start: 0 } });
    jobId = (await submitted.json()).id;
    await expect.poll(async () => (await (await request.get(`/api/preparations/${jobId}`)).json()).state).toBe("done");
    expect((await request.get(`/api/preparations/${jobId}/audio/0`)).status()).toBe(410);
    const page = await source.newPage();
    await page.goto("/library");
    await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
    await page.evaluate(async (key) => {
      const d = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("readaloud"); r.onsuccess = () => resolve(r.result); });
      const tx = d.transaction("audio", "readwrite");
      tx.objectStore("audio").put({ key, blob: new Blob(["existing-device-audio"], { type: "audio/mpeg" }), mime: "audio/mpeg", duration: 2, createdAt: 1 });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      d.close();
    }, key);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect.poll(async () => (await request.get(`/api/preparations/${jobId}/audio/0`)).status()).toBe(200);
    expect(await (await request.get(`/api/preparations/${jobId}/audio/0`)).text()).toBe("existing-device-audio");
    const other = await destination.newPage();
    const writes: string[] = [];
    other.on("request", (r) => { if (r.method() === "POST" && /\/(?:api\/preparations|audio\/speech)$/.test(r.url())) writes.push(r.url()); });
    await other.goto("/library");
    const item = other.getByRole("listitem").filter({ has: other.getByRole("button", { name: id, exact: true }) });
    await expect(item.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toBeVisible();
    expect(writes).toEqual([]);
  } finally {
    await source.close(); await destination.close();
    if (jobId) await request.delete(`/api/preparations/${jobId}`);
    await request.post("/api/library/sync", { data: { changes: [{ kind: "delete", docId: id }] } });
  }
});
