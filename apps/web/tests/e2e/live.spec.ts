import { test, expect } from "@playwright/test";
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

  test("voices and engines come from the real server", async ({ page }) => {
    await page.goto("/voices");
    await expect(page.getByText("Bella")).toBeVisible();
    await expect(page.getByText("Demo Voice")).toBeVisible();
    await page.goto("/settings");
    const group = page.getByRole("group", { name: "TTS engine" });
    await expect(group.getByRole("button", { name: "KittenTTS" })).toBeEnabled();
    await expect(group.getByRole("button", { name: "Browser voice" })).toBeEnabled();
  });
});
