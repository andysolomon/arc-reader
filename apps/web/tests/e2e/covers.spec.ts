import { test, expect, type Page } from "./fixtures";
import { composeText } from "./helpers";
import type { CoverEntry, CoverStatus, DocCovers } from "../../src/lib/coverProtocol";

const ARTICLE = `# Bread Notes

A loaf rises because yeast makes gas, and the dough holds it.

## The starter

Wild yeast lives in flour and water. Fed each day, it stays alive.

## Baking

Steam keeps the crust soft while the loaf springs up. Then the crust browns.`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBPkAAAAASUVORK5CYII=", "base64");

/** Answers /api/covers the way the server does, with the art's progress under the test's control. */
async function coverServer(page: Page, start: CoverStatus = "ready") {
  const state = { status: start as CoverStatus, ensures: [] as { docId: string; retry: boolean }[], docs: new Set<string>() };
  const cover = (key: string, kind: CoverEntry["kind"], heading: string, ordinal: number): CoverEntry => ({
    key, kind, heading, path: kind === "article" ? [] : [heading], level: kind === "article" ? 0 : 2, ordinal, parent: kind === "article" ? "" : "article",
    status: state.status, alt: `An ink drawing for ${heading}.`, updated: 1,
    ...(state.status === "ready" ? { url: `/api/covers/images/${key}.png` } : {}), ...(state.status === "failed" ? { error: "OpenAI image quota or rate limit reached. Retry later." } : {}),
  });
  const covers = (docId: string): DocCovers => ({
    docId, style: "field-notes-1", headings: 3,
    covers: [cover("article", "article", "Bread Notes", -1), cover("s1", "section", "The starter", 1), cover("s2", "section", "Baking", 2)],
  });
  await page.route("**/api/covers/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/covers", "");
    if (path.startsWith("/images/")) return route.fulfill({ contentType: "image/png", body: PNG });
    if (path === "/") {
      return route.fulfill({ json: { configured: true, paused: false, docs: Object.fromEntries([...state.docs].map((id) => [id, { status: state.status, ...(state.status === "ready" ? { url: "/api/covers/images/article.png" } : {}), pending: 0, failed: 0 }])) } });
    }
    const docId = decodeURIComponent(path.split("/")[2]);
    if (request.method() === "POST") {
      const { retry } = request.postDataJSON() as { retry: boolean };
      state.ensures.push({ docId, retry });
      state.docs.add(docId);
      if (retry) state.status = "ready";
    }
    return state.docs.has(docId) ? route.fulfill({ status: request.method() === "POST" ? 202 : 200, json: covers(docId) }) : route.fulfill({ status: 404, json: { error: "This document has no covers yet." } });
  });
  return state;
}

async function read(page: Page) {
  await page.goto("/compose");
  await composeText(page, ARTICLE);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await page.getByRole("region", { name: "Player" }).waitFor();
}

test("an article opens on its cover, and each section opens on its own", async ({ page }) => {
  const server = await coverServer(page);
  await read(page);
  const text = page.getByRole("region", { name: "Document text" });
  const article = text.locator("[data-cover=article]");
  await expect(article).toHaveAttribute("data-cover-status", "ready");
  await expect(article.getByRole("img", { name: "An ink drawing for Bread Notes." })).toBeVisible();
  await expect(article).toContainText("Bread Notes");

  // One cover per section, each straight before the heading it introduces. The title's own heading gets none.
  const sections = text.locator("[data-cover=section]");
  await expect(sections).toHaveCount(2);
  for (const heading of ["The starter", "Baking"]) {
    const before = text.locator("[data-insert]").filter({ hasText: heading });
    await expect(before.locator("[data-cover=section]")).toHaveAttribute("data-cover-status", "ready");
    expect(await before.evaluate((el) => el.nextElementSibling?.tagName + ":" + el.nextElementSibling?.textContent?.trim())).toBe(`H2:${heading}`);
  }
  // The headings are still the document's headings, and the text still seeks: a cover adds nothing to what is read.
  await expect(text.getByRole("heading", { name: "The starter" })).toBeVisible();
  await text.getByText("Steam keeps the crust soft").click();
  await expect(text.locator("[data-i].bg-hl")).toContainText("Steam keeps the crust soft");
  expect(server.ensures).toEqual([{ docId: page.url().split("/").at(-1), retry: false }]);

  // Focus mode is the text alone.
  await page.getByRole("button", { name: "Focus mode" }).click();
  await expect(text.locator("[data-cover]")).toHaveCount(0);
});

test("a cover shows its title while the art is drawn, and the art when it arrives", async ({ page }) => {
  const server = await coverServer(page, "generating");
  await read(page);
  const article = page.locator("[data-cover=article]");
  await expect(article).toHaveAttribute("data-cover-status", "generating");
  await expect(article).toContainText("Bread Notes");
  await expect(article).toContainText("Drawing…");
  await expect(article.getByRole("img")).toHaveCount(0);
  server.status = "ready";
  await expect(article).toHaveAttribute("data-cover-status", "ready", { timeout: 15_000 });
  await expect(page.locator("[data-cover=section][data-cover-status=ready]")).toHaveCount(2);
});

test("a cover that could not be drawn offers to be drawn again", async ({ page }) => {
  const server = await coverServer(page, "failed");
  await read(page);
  const article = page.locator("[data-cover=article]");
  await expect(article).toHaveAttribute("data-cover-status", "failed");
  await expect(article).toContainText("No cover art");
  await article.getByRole("button", { name: "Draw again" }).click();
  await expect(article).toHaveAttribute("data-cover-status", "ready");
  expect(server.ensures.at(-1)?.retry).toBe(true);
});

test("a cover opens full screen, steps to the next, and the gallery shows them all", async ({ page }) => {
  await coverServer(page);
  await read(page);
  const text = page.getByRole("region", { name: "Document text" });
  await expect(text.locator("[data-cover=section][data-cover-status=ready]")).toHaveCount(2);
  const playPause = page.getByRole("region", { name: "Player" }).locator("button[data-playing]");
  await expect(playPause).toHaveAttribute("data-playing", "true");
  await playPause.click();
  await expect(playPause).toHaveAttribute("data-playing", "false");

  // A section's cover opens on itself; the arrow keys step through every cover, the article's first.
  await text.getByRole("button", { name: "View the cover for Baking full screen" }).click();
  const viewer = page.getByRole("dialog", { name: "Baking" });
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("3 of 3");
  await expect(viewer.getByRole("img", { name: "An ink drawing for Baking." })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Bread Notes" })).toContainText("1 of 3");
  // The keys stay with the viewer: nothing plays behind it.
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-image-viewer]")).toHaveCount(0);
  await expect(playPause).toHaveAttribute("data-playing", "false");

  // The gallery: every cover at once, each opening full screen, and Esc back to the gallery.
  await text.getByRole("button", { name: "All 3 covers" }).click();
  const gallery = page.locator("[data-image-viewer=grid]");
  await expect(gallery).toContainText("3 pictures");
  await expect(gallery.locator("[data-cover]")).toHaveCount(3);
  await gallery.getByRole("button", { name: "The starter" }).click();
  await expect(page.getByRole("dialog", { name: "The starter" })).toContainText("2 of 3");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-image-viewer=grid]")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("[data-image-viewer]")).toHaveCount(0);
  await expect(text.getByRole("button", { name: "All 3 covers" })).toBeFocused();
});

test("a cover still being drawn does not open", async ({ page }) => {
  await coverServer(page, "generating");
  await read(page);
  await expect(page.locator("[data-cover=article]")).toHaveAttribute("data-cover-status", "generating");
  await expect(page.getByRole("button", { name: /full screen/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /All \d+ covers/ })).toHaveCount(0);
});

test("the Library shows each article's cover, and Settings turns covers off", async ({ page }) => {
  const server = await coverServer(page);
  await read(page);
  await expect(page.locator("[data-cover=article]")).toHaveAttribute("data-cover-status", "ready");
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.locator("main [data-cover-thumb] img").first()).toHaveAttribute("src", "/api/covers/images/article.png");
  // The cover leads the row, and where the article came from stays on its corner.
  await expect(page.locator("main [data-source-badge]").first()).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("switch", { name: "Covers" }).click();
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.locator("[data-cover-thumb]")).toHaveCount(0);
  await expect(page.locator("[data-source-badge]")).toHaveCount(0);
  const asked = server.ensures.length;
  await page.getByRole("button", { name: "Bread Notes" }).first().click();
  await page.getByRole("region", { name: "Player" }).waitFor();
  await expect(page.getByRole("region", { name: "Document text" }).getByRole("heading", { name: "Baking" })).toBeVisible();
  await expect(page.locator("[data-cover]")).toHaveCount(0);
  expect(server.ensures).toHaveLength(asked);
});

test("reads without covers on a server that cannot draw them", async ({ page }) => {
  // The test server has covers switched off, as one without an image key would.
  await read(page);
  const text = page.getByRole("region", { name: "Document text" });
  await expect(text.getByRole("heading", { name: "Baking" })).toBeVisible();
  await expect(page.locator("[data-cover]")).toHaveCount(0);
});
