import { test, expect } from "./fixtures";
import { composeAndListen } from "./helpers";

test("phone: tab bar, compact bottom player, text controls in a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await composeAndListen(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box!.y).toBeGreaterThan(700); // bottom tab bar
  await expect(page.getByRole("region", { name: "Player" })).toBeVisible();
  await page.getByRole("button", { name: "Text settings" }).click();
  await expect(page.getByRole("dialog", { name: "Text" })).toBeVisible();
});

test("tablet: collapsed rail and floating listening dock", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await composeAndListen(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  const box = await nav.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(64);
  const player = page.getByRole("region", { name: "Player" });
  const pb = await player.boundingBox();
  expect(pb!.height).toBeGreaterThan(90);
  expect(pb!.height).toBeLessThan(140);
  await expect(player).toContainText("The quick brown fox");
});

test("desktop: 300px sidebar and a 760px capsule", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await composeAndListen(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  const box = await nav.boundingBox();
  expect(box!.width).toBe(300);
  const pb = await page.getByRole("region", { name: "Player" }).boundingBox();
  expect(pb!.width).toBe(760);
});

test("phone: opens on the Library, with the other screens as icons and Compose on its own", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await composeAndListen(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link")).toHaveCount(6);
  for (const name of ["Library", "Voices", "Studio", "Settings", "Linux client", "Compose"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  // Icons only: the names are for assistive technology.
  await expect(nav).toHaveText("");
  await expect(nav.getByRole("link", { name: "Library", exact: true })).toHaveAttribute("aria-current", "page");

  // Back from a document returns to the documents, not to Compose.
  await page.getByRole("button", { name: /quick brown fox/ }).click();
  await page.waitForURL(/\/read\//);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Compose", exact: true }).click();
  await expect(page).toHaveURL(/\/compose$/);
  await expect(page.getByTestId("listen")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Compose", exact: true })).toHaveAttribute("aria-current", "page");
});

test("desktop: the sidebar is the library, and a document opens beside it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await composeAndListen(page);
  await page.keyboard.press("Space"); // pause
  const nav = page.getByRole("navigation", { name: "Primary" });
  const documents = nav.getByRole("list", { name: "Documents" });
  const entry = documents.getByRole("link", { name: /quick brown fox/ });
  await expect(entry).toHaveAttribute("aria-current", "page");
  // Every other screen is an icon on the sidebar's foot.
  for (const name of ["Voices", "Studio", "Settings", "Linux client"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();

  // The front door is Compose here: the documents are already alongside it.
  await nav.getByRole("link", { name: "Compose", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("listen")).toBeVisible();
  await expect(entry).not.toHaveAttribute("aria-current", "page");
  await entry.click();
  await page.waitForURL(/\/read\//);
  await expect(page.getByRole("heading", { level: 1 }).first()).toContainText("quick brown fox");
  await expect(entry).toHaveAttribute("aria-current", "page");

  await nav.getByRole("textbox", { name: "Find a document" }).fill("no such document");
  await expect(documents).toContainText("No document matches.");
  await nav.getByRole("textbox", { name: "Find a document" }).fill("QUICK brown");
  await expect(entry).toBeVisible();

  // Collapsed, the sidebar is a column of icons with the Library among them.
  await nav.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(documents).toHaveCount(0);
  await nav.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test.describe("touch phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fields are at least 16px so iOS doesn't zoom on focus", async ({ page }) => {
    for (const path of ["/library", "/voices", "/studio", "/settings", "/auth"]) {
      await page.goto(path);
      await page.locator("input, select, textarea").first().waitFor();
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
          .filter((el) => !["checkbox", "radio", "range", "file", "hidden"].includes(el.type))
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => el.getAttribute("aria-label") || el.placeholder || el.tagName),
      );
      expect(small, path).toEqual([]);
    }
  });

  test("library rows keep their actions hidden until swiped", async ({ page }) => {
    await composeAndListen(page);
    await page.goto("/library");
    const title = page.locator("li").first().getByRole("button").first();
    const del = page.locator("li [aria-label=Delete]").first();
    const t = (await title.boundingBox())!;
    const d = (await del.boundingBox())!;
    // The swipe panel sits under the row, so the row covers the delete button until swiped.
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[aria-label=Delete]"), { x: d.x + d.width / 2, y: d.y + d.height / 2 })).toBeNull();
    expect(t.width).toBeGreaterThan(200);
  });

  test("a tap on a library row opens its document, while a swipe only shows its actions", async ({ page }) => {
    await composeAndListen(page);
    await page.goto("/library");
    const row = page.locator('[data-screen="library"] li').first();
    const source = row.getByText("Pasted text");
    const at = (await source.boundingBox())!;
    const y = at.y + at.height / 2;
    const touch = (type: string, x: number) => row.evaluate((el, e) => { el.dispatchEvent(new PointerEvent(e.type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: e.x, clientY: e.y })); }, { type, x, y });

    // Swipe left. Should the browser still report a click as the finger lifts, the row stays put.
    await touch("pointerdown", 330);
    for (const x of [300, 240, 160, 80]) await touch("pointermove", x);
    await touch("pointerup", 80);
    await source.dispatchEvent("click");
    await expect(row).toHaveAttribute("data-swipe-open", "true");
    await expect(page).toHaveURL(/\/library$/);

    // With the actions showing, a tap on the row puts them away; the next one opens the document.
    await page.touchscreen.tap(60, y);
    await expect(row).not.toHaveAttribute("data-swipe-open");
    await expect(page).toHaveURL(/\/library$/);
    await source.tap();
    await expect(page).toHaveURL(/\/read\//);
    await page.getByRole("button", { name: "Back", exact: true }).tap();
    await expect(page).toHaveURL(/\/library$/);
  });
});
