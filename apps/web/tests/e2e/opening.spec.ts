import { test, expect, type Page } from "./fixtures";
import { TEXT, composeText, seedLibrary } from "./helpers";
import { buildEpub } from "../fixtures/epub";
import { DECK, buildPdf } from "../fixtures/pdf";

/**
 * Every way a document gets opened, and whether it starts reading aloud. Only a listen gesture
 * plays: Play, Listen, Resume, Enter on a link, or text pasted to be read. Pasting a link,
 * uploading a file and choosing a document from a list open it paused.
 */

/** The stub book site, from tests/stub-site.mjs: its contents page lists three chapters. */
const SITE = `http://127.0.0.1:${process.env.E2E_SITE_PORT || 3996}`;
const LINK = "https://example.com/story";

/** The Reader for a document; a shared one passes through /read/new on its way. */
const READER = /\/read\/(?!new\b)[^/?]+$/;

const playPause = (page: Page) => page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^(Play|Pause)/ });

/** Imports, chapters and the first passage's audio all come through the app server. */
const SERVER = { timeout: 15_000 };

/** Listening starts in the same step that opens the document, so its first frame already says so. */
async function expectPaused(page: Page, shows: string) {
  await page.waitForURL(READER);
  await expect(page.getByRole("region", { name: "Document text" })).toContainText(shows, SERVER);
  await expect(page.getByRole("status").filter({ hasText: /^(Ready to listen|Paused)$/ })).toBeVisible();
  await expect(playPause(page)).toHaveAttribute("data-playing", "false");
}

async function expectPlaying(page: Page, shows: string) {
  await page.waitForURL(READER);
  await expect(page.getByRole("region", { name: "Document text" })).toContainText(shows, SERVER);
  await expect(playPause(page)).toHaveAttribute("data-playing", "true", SERVER);
}

async function paste(page: Page, text: string, into?: string) {
  const target = into ? page.getByLabel(into) : page.locator("body");
  await target.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}

test.beforeEach(async ({ page }) => {
  // A voice the stub serves: reading can start before the voice list arrives, and the default voice is not on it.
  await page.addInitScript(() => {
    const raw = localStorage.getItem("readaloud:settings");
    const cur = raw ? JSON.parse(raw) : { state: {}, version: 5 };
    cur.state = { ...cur.state, voice: "phonon:Zoey", voiceChosen: true };
    localStorage.setItem("readaloud:settings", JSON.stringify(cur));
  });
  await page.route(LINK, (route) => route.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: TEXT }));
});

test("a link pasted anywhere opens paused", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await paste(page, LINK);
  await expectPaused(page, "The quick brown fox");
});

test("text pasted anywhere plays", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await paste(page, TEXT);
  await expectPlaying(page, "The quick brown fox");
});

test("a link pasted into Compose's link field opens paused", async ({ page }) => {
  await page.goto("/");
  await paste(page, LINK, "Link to read");
  await expectPaused(page, "The quick brown fox");
});

test("a link pasted into Compose's text box opens paused", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Type or paste text" }).click();
  await paste(page, LINK, "Text to read");
  await expectPaused(page, "The quick brown fox");
});

test("Enter on a link plays", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Link to read").fill(LINK);
  await page.keyboard.press("Enter");
  await expectPlaying(page, "The quick brown fox");
});

test("Listen on a link plays", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Link to read").fill(LINK);
  await page.getByTestId("listen").click();
  await expectPlaying(page, "The quick brown fox");
});

test("Listen on typed text plays", async ({ page }) => {
  await page.goto("/");
  await composeText(page, TEXT);
  await page.getByTestId("listen").click();
  await expectPlaying(page, "The quick brown fox");
});

test("an uploaded EPUB opens paused, and so does choosing it again", async ({ page }) => {
  const epub = { name: "the-farmyard.epub", mimeType: "application/epub+zip", buffer: await buildEpub() };
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(epub);
  await expectPaused(page, "The meeting 1 went on");
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(epub);
  await expectPaused(page, "The meeting 1 went on");
});

test("an uploaded PDF opens paused", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "lecture06.pdf", mimeType: "application/pdf", buffer: buildPdf(DECK) });
  await expectPaused(page, "Workflows chain model calls in a fixed order.");
});

test("a Library row opens paused, and its Play button plays", async ({ page }) => {
  await seedLibrary(page, [null]);
  await page.getByRole("button", { name: "First document", exact: true }).click();
  await expectPaused(page, "First paragraph.");
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "First document", exact: true }) });
  await row.getByRole("button", { name: "Play", exact: true }).click();
  await expectPlaying(page, "First paragraph.");
});

test("a sidebar row opens paused", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLibrary(page, [null]);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("list", { name: "Documents" }).getByRole("link", { name: /First document/ }).click();
  await expectPaused(page, "First paragraph.");
});

test("a shared text plays while Auto-play on share is on", async ({ page }) => {
  await page.goto(`/read/new?title=Shared&text=${encodeURIComponent(TEXT)}`);
  await expectPlaying(page, "The quick brown fox");
});

test("a book's chapters: adding them from the contents page and Next at the end play, a chapter card keeps the player as it was", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Link to read").fill(`${SITE}/`);
  await page.keyboard.press("Enter");
  // A contents page waits to be swapped for its chapters instead of reading itself out.
  await expectPaused(page, "a field manual for one part of the backend");

  await page.getByRole("complementary", { name: "Book" }).getByRole("button", { name: "Add 3 chapters" }).click();
  await expectPlaying(page, "Why HTTP");
  await expect(page.getByRole("status").filter({ hasText: "Reading complete" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Next: Routing" }).click();
  await expectPlaying(page, "Dynamic routes");

  await page.keyboard.press("Space");
  await expect(playPause(page)).toHaveAttribute("data-playing", "false");
  const chapters = page.getByRole("navigation", { name: "Chapters" });
  await chapters.getByRole("button", { name: /Next · Chapter 3/ }).click();
  await expectPaused(page, "Why databases exist");

  await page.keyboard.press("Space");
  await expect(playPause(page)).toHaveAttribute("data-playing", "true");
  await chapters.getByRole("button", { name: /Previous · Chapter 2/ }).click();
  await expectPlaying(page, "Dynamic routes");
});
