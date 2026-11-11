import { test, expect, type Page } from "./fixtures";
import { TEXT, composeText } from "./helpers";

async function pasteInto(page: Page, label: string, text: string) {
  await page.getByLabel(label).evaluate((target, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}

async function expectReading(page: Page, text = "The quick brown fox") {
  await expect(page).toHaveURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.locator("article")).toContainText(text);
}

test("the link field comes first and the text box stays folded away", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Link to read")).toBeVisible();
  await expect(page.getByLabel("Link to read")).toBeFocused();
  await expect(page.getByLabel("Text to read")).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Type or paste text" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Text to read")).toBeFocused();
  await toggle.click();
  await expect(page.getByLabel("Text to read")).toHaveCount(0);
});

test("pasting a link starts reading right away", async ({ page }) => {
  await page.route("https://example.com/story", (route) => route.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: TEXT }));
  await page.goto("/");
  await pasteInto(page, "Link to read", "https://example.com/story");
  await expectReading(page);
});

test("a typed address without a scheme reads on Enter", async ({ page }) => {
  await page.route("https://example.com/story", (route) => route.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: TEXT }));
  await page.goto("/");
  await page.getByLabel("Link to read").fill("example.com/story");
  await page.keyboard.press("Enter");
  await expectReading(page);
});

test("pasting prose into the link field opens the text box with it", async ({ page }) => {
  await page.goto("/");
  await pasteInto(page, "Link to read", TEXT);
  await expect(page.getByLabel("Text to read")).toHaveValue(TEXT);
  await expect(page.getByLabel("Link to read")).toHaveValue("");
  await page.getByTestId("listen").click();
  await expectReading(page);
});

test("a failed fetch keeps the link for another try", async ({ page }) => {
  await page.route("https://example.com/story", (route) => route.abort());
  await page.route("**/api/fetch?**", (route) => route.fulfill({ status: 502, body: "Unavailable" }));
  await page.goto("/");
  await pasteInto(page, "Link to read", "https://example.com/story");
  await expect(page.getByRole("status").filter({ hasText: "Couldn't read example.com" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Link to read")).toHaveValue("https://example.com/story");
});

test("Listen with nothing entered asks for a link or text", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("listen").click();
  await expect(page.getByRole("status").filter({ hasText: "Paste a link or some text first" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("a draft reopens the text box on return", async ({ page }) => {
  await page.goto("/");
  await composeText(page, "Keep this unfinished draft.");
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("link", { name: "Compose", exact: true }).click();
  await expect(page.getByLabel("Text to read")).toHaveValue("Keep this unfinished draft.");
  await expect(page.getByRole("button", { name: "Type or paste text" })).toHaveAttribute("aria-expanded", "true");
});

test("the text box clears with one tap and stays cleared", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Clear text" })).toHaveCount(0);
  await composeText(page, "Some pasted text to throw away.");
  await page.getByRole("button", { name: "Clear text" }).click();
  await expect(page.getByLabel("Text to read")).toHaveValue("");
  await expect(page.getByLabel("Text to read")).toBeFocused();
  await expect(page.getByRole("button", { name: "Clear text" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Text to read")).toHaveCount(0);
});

/** A one-finger drag from (x, y) down by `dy`, as touch events on the element under the finger. */
async function drag(page: Page, x: number, y: number, dy: number, dx = 0) {
  await page.evaluate(
    ({ x, y, dy, dx }) => {
      const el = document.elementFromPoint(x, y)!;
      const fire = (type: string, cx: number, cy: number) => {
        const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
        const touches = type === "touchend" ? [] : [t];
        el.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: [t], bubbles: true, cancelable: true }));
      };
      fire("touchstart", x, y);
      for (let i = 1; i <= 10; i++) fire("touchmove", x + (dx * i) / 10, y + (dy * i) / 10);
      fire("touchend", x + dx, y + dy);
    },
    { x, y, dy, dx },
  );
}

test("pulling down from the top of a page reloads it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => ((window as unknown as { beforeReload: boolean }).beforeReload = true));
  const heading = await page.getByRole("heading", { name: "What should I read to you?" }).boundingBox();
  const x = heading!.x + heading!.width / 2;
  const y = heading!.y + heading!.height / 2;

  // A short pull, or a sideways swipe, springs back without reloading.
  await drag(page, x, y, 80);
  await drag(page, x, y, 40, 300);
  await expect(page.getByTestId("pull-to-refresh")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { beforeReload?: boolean }).beforeReload)).toBe(true);

  await Promise.all([page.waitForEvent("load"), drag(page, x, y, 260)]);
  expect(await page.evaluate(() => (window as unknown as { beforeReload?: boolean }).beforeReload)).toBeUndefined();
});

test("pulling to reload while the server is out of reach keeps the page", async ({ page }) => {
  await page.goto("/");
  await composeText(page, "Keep me on screen.");
  await page.route(/\/\?reachable=/, (route) => route.abort("internetdisconnected"));
  await page.evaluate(() => ((window as unknown as { beforeReload: boolean }).beforeReload = true));
  const heading = await page.getByRole("heading", { name: "What should I read to you?" }).boundingBox();
  await drag(page, heading!.x + heading!.width / 2, heading!.y + heading!.height / 2, 260);
  await expect(page.getByRole("status").filter({ hasText: "Can't reach ReadAloud right now" })).toBeVisible();
  await expect(page.getByTestId("pull-to-refresh")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { beforeReload?: boolean }).beforeReload)).toBe(true);
  await expect(page.getByLabel("Text to read")).toHaveValue("Keep me on screen.");
});
