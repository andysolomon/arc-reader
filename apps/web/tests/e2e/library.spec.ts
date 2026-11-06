import { expect, test, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

async function seedLibrary(page: Page, voiceIds: (string | null)[] = [null, null]) {
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
        const id = ["First", "Second", "Third", "Fourth"][index];
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
  await expect(page.getByRole("checkbox", { name: /Select .* document/ })).toHaveCount(voiceIds.length);
}

test("Library identifies voice services in both views even outside the available catalogue", async ({ page }) => {
  await seedLibrary(page, [null, "alloy", "fish:saved-narrator", "local"]);
  const library = page.locator('[data-screen="library"]');
  const identities = [["First", "VoiceStudio", "Bella"], ["Second", "ChatGPT", "Alloy"], ["Third", "Fish", "Fish Audio voice"], ["Fourth", "Browser", "Browser voice"]];
  for (const view of ["List", "Cards"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    for (const [document, source, voice] of identities) {
      const item = library.getByRole("listitem").filter({ has: page.getByRole("button", { name: `${document} document`, exact: true }) });
      await expect(item.locator(`[data-voice-source="${source}"]`).first()).toBeVisible();
      await expect(item).toContainText(voice);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("prepares multiple documents in multiple voices, reuses saved audio, and shows persisted coverage in both views", async ({ page }) => {
  await seedLibrary(page);
  let submissions = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/preparations", async (route) => {
    if (route.request().method() === "POST") { submissions++; await gate; }
    await route.continue();
  });
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
  try {
    await expect.poll(() => submissions).toBe(4);
    await expect(page.getByRole("region", { name: "Audio preparation queue" })).toContainText("0 active · 4 queued");
  } finally { release(); }
  // Internal navigation keeps the preparation queue alive.
  await page.getByRole("link", { name: "Compose", exact: true }).click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("region", { name: "Audio preparation queue" })).toContainText("Audio preparation finished", { timeout: 15_000 });
  await expect(page.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Jasper: 100% prepared", exact: true })).toHaveCount(2);
  expect(requests).toBe(8);
  await expect(page.getByRole("region", { name: "Player", exact: true })).toBeHidden();

  await page.reload();
  await page.getByRole("checkbox", { name: "Select First document", exact: true }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Bella VoiceStudio" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Alloy ChatGPT" })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Prepare 2 readings" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("checkbox", { name: "Select all", exact: true }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Bella VoiceStudio" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" })).toBeChecked();
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

test("shows live server progress before audio is downloaded, then distinguishes saving from prepared audio", async ({ page }) => {
  await seedLibrary(page, [null]);
  const status = { id: "", state: "running", done: 0, total: 2, queued: true, worker: undefined as string | undefined };
  let submissions = 0;
  await page.route("**/api/preparations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submissions++;
    const response = await route.fetch();
    status.id = (await response.json()).id;
    await route.fulfill({ response, json: status });
  });
  await page.route("**/api/preparations/*", (route) => route.fulfill({ json: status }));
  let downloads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/preparations/*/audio/*", async (route) => {
    downloads++;
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole("checkbox", { name: "Select all", exact: true }).check();
    await page.getByRole("button", { name: "Prepare selected" }).click();
    await page.getByRole("dialog", { name: "Prepare audio", exact: true }).getByRole("button", { name: "Prepare 1 reading", exact: true }).click();
    await expect(page.getByRole("img", { name: "Bella: 0% generated · 0/2 passages · Queued", exact: true })).toBeVisible();

    Object.assign(status, { done: 1, queued: false, worker: "Mac" });
    const live = page.getByRole("img", { name: "Bella: 50% generated · 1/2 passages · Preparing on Mac", exact: true });
    await expect(live).toBeVisible();
    const halfRing = await live.locator("circle").nth(1).getAttribute("stroke-dasharray");
    expect(Number(halfRing!.split(" ")[0]) / Number(halfRing!.split(" ")[1])).toBeCloseTo(0.5);
    expect(downloads).toBe(0);
    await page.getByRole("button", { name: "Cards", exact: true }).click();
    await expect(live).toBeVisible();
    await page.reload();
    await expect(live).toBeVisible();
    expect(submissions).toBe(1);

    Object.assign(status, { done: 2, state: "done" });
    await expect(page.getByRole("img", { name: "Bella: 100% generated · 2/2 passages · Saving audio on this device", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("img", { name: "Bella: 100% prepared", exact: true })).toBeVisible();
  } finally { release(); }
});

test("shows one reading per machine, waiting readings, and restores their assignments after reload", async ({ page }) => {
  await seedLibrary(page);
  const jobs: { id: string; state: string; done: number; total: number; queued: boolean; worker?: string }[] = [];
  await page.route("**/api/preparations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const index = jobs.length;
    const job = { id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`, state: "running", done: 0, total: 2,
      queued: index >= 2, ...(index < 2 ? { worker: ["Mac", "Omarchy"][index] } : {}) };
    jobs.push(job);
    await route.fulfill({ status: 202, json: job });
  });
  await page.route("**/api/preparations/*", async (route) => {
    const job = jobs.find((job) => route.request().url().endsWith(job.id));
    if (!job) return route.continue();
    if (route.request().method() === "DELETE") job.state = "cancelled";
    await route.fulfill({ json: job });
  });
  await page.getByRole("checkbox", { name: "Select all", exact: true }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" }).check();
  await dialog.getByRole("button", { name: "Prepare 4 readings" }).click();
  const queue = page.getByRole("region", { name: "Audio preparation queue" });
  await expect(queue).toContainText("2 active · 2 queued");
  await expect(queue).toContainText("Preparing on Mac");
  await expect(queue).toContainText("Preparing on Omarchy");
  await page.reload();
  await expect(queue).toContainText("2 active · 2 queued");
  await expect(queue).toContainText("Preparing on Mac");
  await expect(queue).toContainText("Preparing on Omarchy");
  expect(jobs).toHaveLength(4);
  await queue.getByRole("button", { name: "Cancel all" }).click();
  await expect(queue.getByText("Cancelled · saved audio kept", { exact: true })).toHaveCount(4);
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

test("the player only offers voices with prepared audio for the open document", async ({ page }) => {
  await seedLibrary(page, [null]);
  await page.getByRole("checkbox", { name: "Select all", exact: true }).check();
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" }).check();
  await dialog.getByRole("button", { name: "Prepare 2 readings" }).click();
  await expect(page.getByRole("img", { name: "Jasper: 100% prepared", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "First document", exact: true }).click();
  await page.waitForURL(/\/read\//);
  await page.getByRole("button", { name: "More" }).first().click();
  await page.getByRole("menuitem", { name: "Change voice for this document" }).click();
  await expect(page.getByText("Choosing a prepared voice for “First document”.", { exact: false })).toBeVisible();
  await expect(page.locator('[data-voice="expr-voice-2-f"]')).toContainText("Selected");
  await expect(page.locator('[data-voice="expr-voice-2-m"]')).toBeVisible();
  await expect(page.locator("[data-voice]")).toHaveCount(2);
  await expect(page.getByRole("status").filter({ hasText: "2 voices" })).toBeVisible();
  // Re-voicing from the Library still offers the whole catalogue.
  await page.goto("/library");
  await page.getByRole("button", { name: "Re-voice" }).first().click();
  await expect(page.getByText("Choosing a voice for “First document”.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-voice="alloy"]')).toBeVisible();
});

test("opening from the Library does not start playback, and finished readings stay counted through a reread", async ({ page }) => {
  await seedLibrary(page, ["local"]);
  await page.getByRole("button", { name: "First document", exact: true }).click();
  await page.waitForURL(/\/read\//);
  const player = page.getByRole("region", { name: "Player" });
  const playPause = player.getByRole("button", { name: /^(Play|Pause)/ });
  await expect(playPause).toHaveAttribute("data-playing", "false");
  await expect(page.locator('article [data-i="0"]')).toHaveClass(/bg-hl/);

  // Read it through to the end.
  await playPause.click();
  await expect(playPause).toHaveAttribute("data-playing", "true");
  await expect(playPause).toHaveAttribute("data-playing", "false", { timeout: 30_000 });
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const item = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "First document", exact: true }) });
  await expect(item.getByRole("img", { name: "100% listened", exact: true })).toBeVisible();
  await expect(item.getByLabel("Read once", { exact: true })).toBeVisible();

  // Rereading starts over and tracks the new pass while the badge remains.
  await item.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL(/\/read\//);
  await expect(playPause).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Space");
  await expect(playPause).toHaveAttribute("data-playing", "false");
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(item.getByLabel("Read once", { exact: true })).toBeVisible();
  await expect(item.getByRole("img", { name: /^(?!100%)\d+% listened$/ })).toBeVisible();
  await page.reload();
  await expect(item.getByLabel("Read once", { exact: true })).toBeVisible();
});
