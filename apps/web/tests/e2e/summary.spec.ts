import { test, expect } from "./fixtures";
import { composeAndListen } from "./helpers";

test("summarizes a document once, keeps it across reloads, and hides it", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => { if (r.url().includes("/api/llm/v1/chat/completions")) calls++; });
  await composeAndListen(page);
  await page.getByRole("button", { name: "Summarize" }).click();
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toContainText("A stub summary of the main point.");
  await expect(summary).toContainText("One key idea from the article.");
  await expect(page.getByRole("button", { name: "Hide summary" }).first()).toHaveAttribute("aria-pressed", "true");

  // Saved on the document and the panel stays open, so a reload costs no new request.
  await page.reload();
  await expect(summary).toContainText("A stub summary of the main point.");
  expect(calls).toBe(1);

  await summary.getByRole("button", { name: "Hide summary" }).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Summarize" })).toHaveAttribute("aria-pressed", "false");
});

test("enters, replaces, and removes the OpenCode Go key in Settings", async ({ page }) => {
  await page.goto("/settings");
  // The stub server starts with LLM_API_KEY set.
  await expect(page.getByText("Set on the server (LLM_API_KEY) · ends in -key")).toBeVisible();
  await page.getByRole("button", { name: "Replace" }).click();
  const field = page.getByLabel("OpenCode Go API key");
  await field.fill("wrong-key");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("didn't accept that key");
  await field.fill("oa-test-key");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved on this server · ends in -key")).toBeVisible();
  await expect(field).toHaveCount(0);
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Set on the server (LLM_API_KEY) · ends in -key")).toBeVisible();
});

test("reads the summary aloud with the document's voice and returns to the article's place", async ({ page }) => {
  const spoken: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/v1/audio/speech") && r.method() === "POST") spoken.push(JSON.parse(r.postData() || "{}").input ?? "");
  });
  await composeAndListen(page);
  await page.keyboard.press("Space"); // pause the article
  const position = () => page.evaluate(async () => {
    const d = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("readaloud"); r.onsuccess = () => resolve(r.result); });
    const id = location.pathname.split("/").pop()!;
    return new Promise<{ index: number; updatedAt: number } | undefined>((resolve) => { const r = d.transaction("positions").objectStore("positions").get(id); r.onsuccess = () => resolve(r.result); });
  });
  await expect.poll(position).toBeTruthy();
  const before = await position();

  await page.getByRole("button", { name: "Summarize" }).click();
  await page.getByRole("region", { name: "Summary" }).getByRole("button", { name: "Listen" }).click();
  // The Reader now shows and highlights the summary, and speech is generated from it.
  await expect(page.getByText("Read the full article")).toBeVisible();
  await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
  await expect(page.locator('[data-screen="reader"]')).toContainText("A stub summary of the main point.");
  await expect(page.locator('[data-screen="reader"]')).not.toContainText("Pack my box");
  await expect.poll(() => spoken.some((text) => text.includes("A stub summary of the main point."))).toBe(true);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1200); // past the engine's persist delay

  // Listening to the summary leaves the article's saved place alone.
  expect(await position()).toEqual(before);
  await page.getByRole("button", { name: "Read the full article" }).click();
  await expect(page.locator('[data-screen="reader"]')).toContainText("Pack my box");
  await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
});
