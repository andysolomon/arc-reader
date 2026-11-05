import { test, expect, type Page } from "@playwright/test";
import { TEXT } from "./helpers";

async function clipboard(page: Page, text: string, mode: "ok" | "denied" | "unavailable" = "ok") {
  await page.addInitScript(({ text, mode }) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: mode === "unavailable" ? undefined : {
        readText: async () => {
          if (mode === "denied") throw new DOMException("Permission denied", "NotAllowedError");
          return text;
        },
      },
    });
  }, { text, mode });
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

test("read clipboard from the library without opening the composer", async ({ page }) => {
  await clipboard(page, TEXT);
  await page.goto("/library");
  await page.getByRole("button", { name: "Read clipboard", exact: true }).click();
  await expectReading(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.locator("li")).toHaveCount(1);
});

test("the composer clipboard action reads immediately and preserves an existing draft", async ({ page }) => {
  await clipboard(page, TEXT);
  await page.goto("/");
  await page.getByLabel("Text to read").fill("Keep this unfinished draft.");
  await page.locator('[data-screen="compose"]').getByRole("button", { name: "Read clipboard", exact: true }).click();
  await expectReading(page);
  await page.getByRole("link", { name: "Compose", exact: true }).click();
  await expect(page.getByLabel("Text to read")).toHaveValue("Keep this unfinished draft.");
});

test("pasting outside fields imports text even without the clipboard API", async ({ page }) => {
  await clipboard(page, "", "unavailable");
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
  await page.getByLabel("Text to read").fill("Existing draft");
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

test("a copied article URL imports the article instead of reading its address", async ({ page }) => {
  await clipboard(page, "https://example.com/story");
  await page.route("https://example.com/story", (route) => route.fulfill({
    contentType: "text/html",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: `<html><head><title>Clipboard article</title></head><body><article><p>${TEXT}</p></article></body></html>`,
  }));
  await page.goto("/library");
  await page.getByRole("button", { name: "Read clipboard", exact: true }).click();
  await expectReading(page);
  await expect(page.getByRole("heading", { name: "Clipboard article", exact: true })).toBeVisible();
});

test("an unreadable copied URL reports the failure and allows another import", async ({ page }) => {
  await clipboard(page, "https://example.com/story");
  await page.route("https://example.com/story", (route) => route.abort());
  await page.route("**/api/fetch?**", (route) => route.fulfill({ status: 502, body: "Unavailable" }));
  await page.goto("/library");
  const read = page.getByRole("button", { name: "Read clipboard", exact: true });
  await read.click();
  await expect(page.getByRole("status")).toContainText("Couldn't read example.com");
  await expect(read).toBeEnabled();
  await expect(page.getByText("Nothing here yet.", { exact: false })).toBeVisible();
  await paste(page, TEXT);
  await expectReading(page);
});

for (const mode of ["denied", "unavailable"] as const) {
  test(`clipboard ${mode} explains the paste fallback and remains usable`, async ({ page }) => {
    await clipboard(page, TEXT, mode);
    await page.goto("/library");
    const read = page.getByRole("button", { name: "Read clipboard", exact: true });
    await read.click();
    await expect(page.getByRole("status")).toContainText(/outside a text field/);
    await expect(read).toBeEnabled();
    await expect(page).toHaveURL(/\/library$/);
    await paste(page, TEXT);
    await expectReading(page);
  });
}

test("an empty clipboard does not create a document", async ({ page }) => {
  await clipboard(page, " \n ");
  await page.goto("/library");
  await page.getByRole("button", { name: "Read clipboard", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Clipboard is empty");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText("Nothing here yet.", { exact: false })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Read clipboard", exact: true })).toBeDisabled();
  await paste(page, TEXT);
  finishFetch();
  await expectReading(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.locator("li")).toHaveCount(1);
});

test("phone exposes Read clipboard without opening Compose", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clipboard(page, TEXT);
  await page.goto("/library");
  await page.getByRole("button", { name: "Read clipboard", exact: true }).click();
  await expectReading(page);
});
