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
  await expect(page.locator('[data-screen="library"] li').getByRole("button", { name: / document$/ })).toHaveCount(voiceIds.length);
}

/** Rows carry no checkboxes: Select starts picking, and the bar that appears picks every document shown. */
async function selectAll(page: Page, name = "Select all") {
  const selection = page.getByRole("toolbar", { name: "Selection" });
  if (!(await selection.isVisible())) await page.getByRole("button", { name: "Select", exact: true }).click();
  await selection.getByRole("button", { name, exact: true }).click();
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
      // The voice a document is read in leads its prepared audio.
      if (source !== "Browser") await expect(item.getByRole("group", { name: "Prepared audio" }).getByRole("button").first()).toHaveAttribute("data-reading-voice", "true");
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // On a phone the text starts beside the source mark instead of behind a wide gutter.
  await page.getByRole("button", { name: "List", exact: true }).click();
  const title = page.getByRole("button", { name: "First document", exact: true });
  const row = library.getByRole("listitem").filter({ has: title });
  expect((await title.boundingBox())!.x - (await row.boundingBox())!.x).toBeLessThan(64);
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
  await selectAll(page);
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await expect(dialog.getByRole("checkbox", { name: "Bella VoiceStudio" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" }).check();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole("button", { name: "Prepare 4 readings" }).click();
  // Queueing ends the selection, so a press opens a document again.
  await expect(page.getByRole("toolbar", { name: "Selection" })).toHaveCount(0);
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

  // Selecting ends with the page; while it is on, a press picks a document instead of opening it.
  await page.reload();
  await expect(page.locator('[data-screen="library"]').getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const first = page.getByRole("button", { name: "First document", exact: true });
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("toolbar", { name: "Selection" })).toContainText("1 selected");
  await page.getByRole("button", { name: "Prepare selected" }).click();
  // Voices with complete audio are not preselected.
  await expect(dialog.getByRole("checkbox", { name: "Bella VoiceStudio" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Jasper VoiceStudio" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Alloy ChatGPT" })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Prepare 0 readings" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await selectAll(page);
  await page.getByRole("button", { name: "Prepare selected" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Bella VoiceStudio" })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "Bella VoiceStudio" }).check();
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

test("shows live server progress before audio is downloaded, then distinguishes saving from prepared audio", async ({ page }) => {
  await seedLibrary(page, [null]);
  const status = { id: "", state: "running", done: 0, total: 2, queued: true, worker: undefined as string | undefined, waitingFor: undefined as string | undefined };
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
    await selectAll(page);
    await page.getByRole("button", { name: "Prepare selected" }).click();
    await page.getByRole("dialog", { name: "Prepare audio", exact: true }).getByRole("button", { name: "Prepare 1 reading", exact: true }).click();
    await expect(page.getByRole("img", { name: "Bella: 0% generated · 0/2 passages · Queued", exact: true })).toBeVisible();
    // A voice only the Mac has names the machine it is waiting for.
    status.waitingFor = "Mac";
    await expect(page.getByRole("img", { name: "Bella: 0% generated · 0/2 passages · Waiting for Mac", exact: true })).toBeVisible();

    Object.assign(status, { done: 1, queued: false, worker: "Mac", waitingFor: undefined });
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
  await selectAll(page);
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

test("a voice opens its preparation details, where a waiting reading is moved up or started now", async ({ page }) => {
  await seedLibrary(page, [null]);
  await page.setViewportSize({ width: 390, height: 844 });
  interface Job { id: string; state: string; done: number; total: number; queued: boolean; worker?: string; waitingFor?: string; ahead?: number; busy?: boolean; prioritized?: boolean }
  const jobs = new Map<string, Job>();
  const moves: boolean[] = [];
  await page.route("**/api/preparations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const voice = route.request().postDataJSON().requests[0].voice as string;
    // Bella has the Mac; Jasper waits behind a reading from another device.
    const job: Job = voice === "expr-voice-2-f"
      ? { id: "00000000-0000-0000-0000-000000000001", state: "running", done: 1, total: 2, queued: false, worker: "Mac" }
      : { id: "00000000-0000-0000-0000-000000000002", state: "running", done: 0, total: 2, queued: true, waitingFor: "Mac", ahead: 1, busy: true };
    jobs.set(voice, job);
    await route.fulfill({ status: 202, json: job });
  });
  await page.route("**/api/preparations/*", async (route) => {
    const job = [...jobs.values()].find((job) => route.request().url().endsWith(job.id));
    if (!job) return route.continue();
    if (route.request().method() === "DELETE") {
      job.state = "cancelled";
      // The machine it held is free for whoever is waiting.
      for (const other of jobs.values()) other.busy = undefined;
    }
    await route.fulfill({ json: job });
  });
  await page.route("**/api/preparations/*/priority", async (route) => {
    const { now } = route.request().postDataJSON() as { now: boolean };
    moves.push(now);
    const [bella, jasper] = [jobs.get("expr-voice-2-f")!, jobs.get("expr-voice-2-m")!];
    if (now) {
      Object.assign(bella, { queued: true, worker: undefined, waitingFor: "Mac", ahead: 0, busy: true });
      Object.assign(jasper, { queued: false, worker: "Mac", waitingFor: undefined, ahead: undefined, busy: undefined, prioritized: undefined });
    } else Object.assign(jasper, { ahead: 0, prioritized: true });
    await route.fulfill({ json: jasper });
  });
  await selectAll(page);
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const prepare = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await prepare.getByRole("checkbox", { name: "Jasper VoiceStudio" }).check();
  await prepare.getByRole("button", { name: "Prepare 2 readings" }).click();
  const queue = page.getByRole("region", { name: "Audio preparation queue" });
  await expect(queue).toContainText("1 active · 1 queued");

  const voices = page.getByRole("group", { name: "Prepared audio" });
  await voices.getByRole("button", { name: /Jasper/ }).click();
  const details = page.getByRole("dialog", { name: "Audio preparation", exact: true });
  await expect(details).toContainText("First document");
  await expect(details).toContainText("Queued · waiting for Mac");
  await expect(details).toContainText("1 reading ahead");
  await expect(details).toContainText("0 of 2 passages");
  await expect(details).toContainText("0% saved");
  await expect(details).toContainText("Extra prepared voice");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await details.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await details.getByRole("button", { name: "Prepare next" }).click();
  await expect(details).toContainText("Next, after the reading in progress · moved to the front");
  await expect(details.getByRole("button", { name: "Prepare next" })).toBeDisabled();
  await details.getByRole("button", { name: "Start now" }).click();
  await expect(details).toContainText("Preparing on Mac");
  await expect(details.getByRole("button", { name: "Prepare next" })).toHaveCount(0);
  expect(moves).toEqual([false, true]);
  // The reading that gave way is waiting again, and says so wherever it is shown.
  await expect(queue).toContainText("Queued · waiting for Mac");

  await details.getByRole("button", { name: "Cancel preparation" }).click();
  await expect(details).toContainText("Cancelled · saved audio kept");
  await expect(details.getByRole("button", { name: "Prepare audio" })).toBeVisible();
  await details.getByRole("button", { name: "Close" }).click();
  await expect(details).toHaveCount(0);

  // The queue opens the same details, and they lead on to the other voices.
  await queue.getByRole("button", { name: "First document Bella" }).click();
  await expect(details.getByText("Reading voice", { exact: true })).toBeVisible();
  await expect(details).toContainText("Next in line");
  await details.getByRole("button", { name: "More voices…" }).click();
  await expect(details).toHaveCount(0);
  await expect(prepare).toContainText("First document");
});

test("selects filtered documents and offers explicit paid voice preparation", async ({ page }) => {
  await seedLibrary(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("textbox", { name: "Search library" }).fill("First");
  await selectAll(page, "Select visible");
  await page.getByRole("button", { name: "Prepare selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare audio", exact: true });
  await expect(dialog).toContainText("First document");
  await dialog.getByRole("checkbox", { name: "Bella VoiceStudio" }).uncheck();
  await dialog.getByRole("textbox", { name: "Search preparation voices" }).fill("Alloy");
  await dialog.getByRole("checkbox", { name: "Alloy ChatGPT" }).check();
  await expect(dialog).toContainText("bill uncached audio for the full document");
  await expect(dialog.getByLabel("Estimated cost")).toContainText(/Estimated cost ≈<?\$\d/);
  await dialog.getByRole("button", { name: "Prepare 1 reading", exact: true }).click();
  await expect(page.getByRole("img", { name: "Alloy: 100% prepared", exact: true })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search library" }).fill("");
  await expect(page.getByRole("img", { name: "Alloy: 100% prepared", exact: true })).toHaveCount(1);
  const library = page.locator('[data-screen="library"]');
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("the player only offers voices with prepared audio for the open document", async ({ page }) => {
  await seedLibrary(page, [null]);
  await selectAll(page);
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

test("keeps documents in the order they were added and sorts by duration on request", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("readaloud");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Oldest was edited last (say, filed by Jev); that must not move it to the top.
    const seeds = [["Oldest", 1, 900, 30], ["Middle", 2, 2, 5], ["Newest", 3, 3, 80]] as const;
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("docs", "readwrite");
      for (const [id, createdAt, updatedAt, sentences] of seeds) {
        const text = Array.from({ length: sentences }, (_, i) => `${id} sentence number ${i} carries on for a while.`).join(" ");
        tx.objectStore("docs").put({ id, title: `${id} document`, text, voice: null, source: "paste", domain: "Pasted text", chars: text.length, createdAt, updatedAt });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.reload();
  const titles = page.locator('[data-screen="library"] li').getByRole("button", { name: / document$/ });
  await expect(titles).toHaveText(["Newest document", "Middle document", "Oldest document"]);
  await page.getByRole("button", { name: "Shortest first" }).click();
  await expect(titles).toHaveText(["Middle document", "Oldest document", "Newest document"]);
  await page.getByRole("button", { name: "Shortest first" }).click();
  await expect(titles).toHaveText(["Newest document", "Oldest document", "Middle document"]);
  // The choice survives a reload, and the calendar button restores the default.
  await page.reload();
  await expect(titles).toHaveText(["Newest document", "Oldest document", "Middle document"]);
  await page.getByRole("button", { name: "Newest first" }).click();
  await expect(titles).toHaveText(["Newest document", "Middle document", "Oldest document"]);
});
