import { test, expect, type Page } from "./fixtures";
import { TEXT, composeText } from "./helpers";

async function withoutClipboardApi(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
}

async function paste(page: Page, text: string, selector = "body") {
  await page.locator(selector).evaluate((target, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}

async function expectReading(page: Page, text = "The quick brown fox") {
  await expect(page).toHaveURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.locator("article")).toContainText(text);
  await expect(page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Pause/ })).toHaveAttribute("data-playing", "true");
}

test("pasting outside fields imports text even without the clipboard API", async ({ page }) => {
  await withoutClipboardApi(page);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await paste(page, TEXT);
  await expectReading(page);
});

test("Ctrl/Cmd+V reads the browser clipboard without focusing an input", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT);
  await page.keyboard.press("ControlOrMeta+V");
  await expectReading(page);
});

test("pasting in text fields and editable content leaves normal editing alone", async ({ page }) => {
  await page.goto("/");
  await composeText(page, "Existing draft");
  await paste(page, TEXT, "textarea");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Text to read")).toHaveValue("Existing draft");
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await paste(page, TEXT, "input");
  await page.evaluate(() => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.id = "clipboard-editor";
    editor.innerHTML = "<span>Editable content</span>";
    document.body.append(editor);
  });
  await paste(page, TEXT, "#clipboard-editor span");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText("Nothing here yet.", { exact: false })).toBeVisible();
});

test("a pasted article URL imports the article instead of reading its address", async ({ page }) => {
  await page.route("https://example.com/story", (route) => route.fulfill({
    contentType: "text/html",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: `<html><head><title>Clipboard article</title></head><body><article><p>${TEXT}</p></article></body></html>`,
  }));
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await paste(page, "https://example.com/story");
  await expectReading(page);
  await expect(page.getByRole("heading", { name: "Clipboard article", exact: true })).toBeVisible();
});

test("an unreadable pasted URL reports the failure and allows another import", async ({ page }) => {
  await page.route("https://example.com/story", (route) => route.abort());
  await page.route("**/api/fetch?**", (route) => route.fulfill({ status: 502, body: "Unavailable" }));
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await paste(page, "https://example.com/story");
  await expect(page.getByRole("status").filter({ hasText: "Couldn't read example.com" })).toBeVisible();
  await expect(page.getByText("Nothing here yet.", { exact: false })).toBeVisible();
  await paste(page, TEXT);
  await expectReading(page);
});

test("repeated paste while fetching imports only one document", async ({ page }) => {
  let finishFetch!: () => void;
  const pending = new Promise<void>((resolve) => { finishFetch = resolve; });
  await page.route("https://example.com/story", async (route) => {
    await pending;
    await route.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: TEXT });
  });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await paste(page, "https://example.com/story");
  await paste(page, TEXT);
  finishFetch();
  await expectReading(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.locator("li")).toHaveCount(1);
});
