import { test, expect } from "./fixtures";
import { TEXT } from "./helpers";

test.describe("OpenAI voices (stub server)", () => {
  test("selecting an OpenAI voice routes to the OpenAI proxy with the OpenAI model", async ({ page }) => {
    await page.goto("/voices");
    await page.getByRole("button", { name: "Use" }).nth(0).waitFor();
    const nova = page.locator('[data-voice="nova"]');
    await expect(nova).toBeVisible();
    await nova.getByRole("button", { name: "Use" }).click();
    await page.goto("/");
    await page.getByLabel("Text to read").fill(TEXT);
    const first = page.waitForResponse((r) => r.url().includes("/api/oa/v1/audio/speech") && r.request().method() === "POST");
    const auth: string[] = [];
    page.on("request", (q) => { if (q.headers()["authorization"]) auth.push(q.url()); });
    await page.getByTestId("listen").click();
    const r = await first;
    expect(r.status()).toBe(200);
    expect(JSON.parse(r.request().postData() ?? "{}")).toMatchObject({ model: "gpt-4o-mini-tts", voice: "nova", speed: 1, response_format: "mp3" });
    await expect(page.getByRole("button", { name: /^(Play|Pause)/ })).toHaveAttribute("data-playing", "true");
    expect(auth).toEqual([]);
  });

  test("OpenAI generates only one passage ahead and offers no Prepare audio", async ({ page }) => {
    await page.goto("/voices");
    await page.locator('[data-voice="sage"]').getByRole("button", { name: "Use" }).click();
    await page.goto("/");
    // Three paragraphs → three passages: the current one, then a single prefetch
    await page.getByLabel("Text to read").fill(`${TEXT}\n\nA third paragraph makes a third passage.`);
    let requests = 0;
    let preparations = 0;
    page.on("request", (q) => { if (q.url().includes("/api/oa/v1/audio/speech")) requests++; });
    page.on("request", (q) => { if (q.url().endsWith("/api/preparations") && q.method() === "POST") preparations++; });
    await page.getByTestId("listen").click();
    await expect(page.getByRole("button", { name: /^(Play|Pause)/ })).toHaveAttribute("data-playing", "true");
    await expect.poll(() => requests, { timeout: 10_000 }).toBe(2);
    await page.waitForTimeout(1000);
    expect(requests).toBe(2);
    expect(preparations).toBe(0);
    await page.getByRole("button", { name: "More" }).first().click();
    await expect(page.getByRole("menuitem", { name: "Change voice for this document" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Prepare audio" })).toHaveCount(0);
  });

  test("usage counts OpenAI characters separately", async ({ page }) => {
    await page.goto("/voices");
    await page.locator('[data-voice="alloy"]').getByRole("button", { name: "Use" }).click();
    await page.goto("/");
    await page.getByLabel("Text to read").fill(TEXT);
    await page.getByTestId("listen").click();
    await page.waitForURL(/\/read\//);
    await page.waitForResponse((r) => r.url().includes("/api/oa/v1/audio/speech"));
    // usage is recorded after the clip is decoded; wait for the counter rather than the response
    await expect.poll(() => page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem("readaloud:usage") ?? "{}").rows ?? [];
      return rows.filter((r: { provider: string }) => r.provider === "openai").reduce((sum: number, r: { characters: number }) => sum + r.characters, 0);
    }), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.goto("/settings");
    const usage = page.locator('[data-provider-usage="openai"]');
    await expect(usage.getByText(/input \/ .* output tokens/)).toBeVisible();
    await expect(usage.getByText(/≈ \$/)).toBeVisible();
  });
});
