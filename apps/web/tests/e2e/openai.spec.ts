import { test, expect } from "@playwright/test";
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

  test("OpenAI requests are not serialized behind the local server", async ({ page }) => {
    await page.goto("/voices");
    await page.locator('[data-voice="sage"]').getByRole("button", { name: "Use" }).click();
    await page.goto("/");
    await page.getByLabel("Text to read").fill(TEXT);
    const starts: number[] = [];
    page.on("request", (q) => { if (q.url().includes("/api/oa/v1/audio/speech")) starts.push(Date.now()); });
    await page.getByTestId("listen").click();
    await expect.poll(() => starts.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    // Current + two prefetches are issued together (within 300 ms), not one after another
    expect(starts[2] - starts[0]).toBeLessThan(300);
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
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("readaloud:usage") ?? "{}").byEngine?.openai ?? 0), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.goto("/settings");
    await expect(page.getByText(/OpenAI .* chars ≈ \$/)).toBeVisible();
  });
});
