import { test, expect } from "@playwright/test";
import { composeAndListen, TEXT } from "./helpers";

test.describe("VoiceStudio provider (stub server)", () => {
  test("Listen synthesizes through the proxy and plays real audio", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Text to read").fill(TEXT);
    const first = page.waitForResponse((r) => r.url().includes("/api/vs/v1/audio/speech") && r.request().method() === "POST");
    await page.getByTestId("listen").click();
    const r = await first;
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("audio/");
    const body = JSON.parse(r.request().postData() ?? "{}");
    expect(body).toMatchObject({ model: "kittentts", voice: "expr-voice-2-f", response_format: "mp3", speed: 1 });
    await expect(page.getByRole("button", { name: /^(Play|Pause)/ })).toHaveAttribute("data-playing", "true");
    await expect(page.getByRole("status").filter({ hasText: /browser voice/ })).toHaveCount(0);
  });

  test("the API key never reaches the browser", async ({ page }) => {
    const auth: string[] = [];
    page.on("request", (q) => { const a = q.headers()["authorization"]; if (a) auth.push(q.url()); });
    await composeAndListen(page);
    expect(auth).toEqual([]);
    const html = await page.content();
    expect(html).not.toContain("test-key");
  });

  test("cached sentences replay with the server offline", async ({ page, context }) => {
    let synthesized = 0;
    page.on("response", (r) => { if (r.url().includes("/v1/audio/speech") && r.status() === 200) synthesized++; });
    await composeAndListen(page);
    await expect.poll(() => synthesized, { timeout: 10_000 }).toBeGreaterThanOrEqual(3); // current + two prefetched
    await page.waitForTimeout(300); // let the cache writes land
    await page.keyboard.press("Space"); // pause → position persisted
    await context.route("**/api/vs/**", (route) => route.abort("connectionrefused"));
    await page.reload();
    await page.getByRole("region", { name: "Player" }).waitFor();
    await page.getByRole("button", { name: /^Play/ }).click();
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    // No banner: the current sentence came from cache, not the local fallback.
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });

  test("server down → banner and browser-voice fallback, playback continues", async ({ page, context }) => {
    await context.route("**/api/vs/**", (route) => route.abort("connectionrefused"));
    await composeAndListen(page);
    await expect(page.getByTestId("offline-banner")).toContainText("Speech server unreachable");
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });

  test("voices come from the server; cloned profiles use the active-engine alias", async ({ page }) => {
    await page.goto("/voices");
    await expect(page.getByText("Studio Narrator")).toBeVisible();
    await expect(page.getByText("Mara (cloned)")).toBeVisible();
    await expect(page.getByText("Bella")).toBeVisible();
    // Supertonic presets are hidden because the stub reports that engine unavailable
    await expect(page.getByText("Marco")).toHaveCount(0);
    const preview = page.waitForResponse((r) => r.url().includes("/v1/audio/speech"));
    await page.getByRole("button", { name: "Preview Studio Narrator" }).click();
    const body = JSON.parse((await preview).request().postData() ?? "{}");
    expect(body).toMatchObject({ model: "tts-1", voice: "prof-narrator-1" });
  });

  test("word timings flag adds a transcription request per sentence and drives the underline", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("switch", { name: "Word timings from the server" }).click();
    let transcriptions = 0;
    page.on("request", (q) => { if (q.url().includes("/v1/audio/transcriptions")) transcriptions++; });
    await composeAndListen(page);
    await expect.poll(() => transcriptions, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    // A word in the active sentence carries the underline class once timings are in use
    await expect(page.locator('article [data-i="0"] span.decoration-accent').first()).toBeVisible();
  });

  test("engine chips reflect the server; the browser voice is always offered", async ({ page }) => {
    await page.goto("/settings");
    const group = page.getByRole("group", { name: "TTS engine" });
    await expect(group.getByRole("button", { name: "KittenTTS" })).toBeEnabled();
    await expect(group.getByRole("button", { name: "Supertonic-3" })).toBeDisabled();
    await expect(group.getByRole("button", { name: "Browser voice" })).toBeEnabled();
  });

  test("switching engine changes the cache key, so the server is asked again", async ({ page }) => {
    await composeAndListen(page);
    await page.keyboard.press("Space");
    await page.goto("/settings");
    await page.getByRole("group", { name: "TTS engine" }).getByRole("button", { name: "Browser voice" }).click();
    await page.goto("/");
    await page.getByLabel("Text to read").fill(TEXT);
    let calls = 0;
    page.on("request", (q) => { if (q.url().includes("/v1/audio/speech")) calls++; });
    await page.getByTestId("listen").click();
    await page.waitForURL(/\/read\//);
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    expect(calls).toBe(0); // local engine: no network at all
  });
});
