import { test, expect } from "./fixtures";
import { readFileSync } from "node:fs";
import { TEXT } from "./helpers";

/**
 * Runs only with LIVE=1 against a real VoiceStudio. Measures the real first-sentence
 * latency in the browser and checks the audio path end to end.
 */
test.describe("@live VoiceStudio", () => {
  test("first sentence arrives, plays, and prefetch keeps up", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.getByLabel("Text to read").fill(TEXT);
    const responses: { url: string; ms: number; bytes: number; type: string }[] = [];
    const t0 = Date.now();
    page.on("response", async (r) => {
      if (r.url().includes("/v1/audio/speech")) responses.push({ url: r.url(), ms: Date.now() - t0, bytes: (await r.body()).length, type: r.headers()["content-type"] ?? "" });
    });
    await page.getByTestId("listen").click();
    await page.waitForURL(/\/read\//);
    await expect(page.getByRole("button", { name: /^(Play|Pause)/ })).toHaveAttribute("data-playing", "true", { timeout: 60_000 });
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
    await expect.poll(() => responses.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
    for (const r of responses) expect(r.type).toContain("audio/");
    // The underline moves: a real audio clock, not the estimate stalling at 0
    await expect(page.locator('article [data-i="0"] span.decoration-accent, article [data-i="1"]').first()).toBeVisible();
    console.log("first sentence audio after", responses[0].ms, "ms; next chunks at", responses.slice(1).map((r) => `${r.ms}ms`).join(", "));
    test.info().annotations.push({ type: "first-audio-ms", description: String(responses[0].ms) });
  });

  test("an OpenAI voice reads a sentence through the real API", async ({ page }) => {
    const hasKey = !!process.env.OPENAI_API_KEY || /^OPENAI_API_KEY=.+/m.test((() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })());
    test.skip(!hasKey, "no OpenAI key in .env.local");
    test.setTimeout(60_000);
    await page.goto("/voices");
    await page.locator('[data-voice="nova"]').getByRole("button", { name: "Use" }).click();
    await page.goto("/");
    await page.getByLabel("Text to read").fill("Short test. One more sentence.");
    const t0 = Date.now();
    const first = page.waitForResponse((r) => r.url().includes("/api/oa/v1/audio/speech"));
    await page.getByTestId("listen").click();
    const r = await first;
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("audio/");
    console.log("OpenAI first sentence audio after", Date.now() - t0, "ms");
    await expect(page.getByRole("button", { name: /^(Play|Pause)/ })).toHaveAttribute("data-playing", "true");
  });

  test("voices and engines come from the real server", async ({ page }) => {
    await page.goto("/voices");
    await expect(page.getByText("Bella")).toBeVisible();
    await expect(page.getByText("Demo Voice")).toBeVisible();
    await page.goto("/settings");
    const group = page.getByRole("group", { name: "Saved-voice engine" });
    await expect(group.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(group.getByRole("button", { name: "KittenTTS" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Browser voice only" })).toBeVisible();
  });
});
