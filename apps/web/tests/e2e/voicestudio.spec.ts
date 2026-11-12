import type { Route } from "@playwright/test";
import { test, expect } from "./fixtures";
import { composeAndListen, TEXT, composeText } from "./helpers";

test.describe("VoiceStudio provider (stub server)", () => {
  test("Listen synthesizes through the proxy and plays real audio", async ({ page }) => {
    await page.goto("/");
    await composeText(page, TEXT);
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

  test("cached passages replay with the server offline", async ({ page, context }) => {
    await composeAndListen(page);
    await expect(page.getByText("Audio prepared — playback no longer waits on the server", { exact: true })).toBeVisible();
    await page.keyboard.press("Space"); // pause → position persisted
    await context.route("**/api/vs/**", (route) => route.abort("connectionrefused"));
    await page.reload();
    await page.getByRole("region", { name: "Player" }).waitFor();
    await page.getByRole("button", { name: /^Play/ }).click();
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    // No banner: the current passage came from cache, not the local fallback.
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });

  test("server down → playback waits and offers the browser voice instead of switching silently", async ({ page, context }) => {
    await context.route("**/api/vs/**", (route) => route.abort("connectionrefused"));
    await context.route(/\/api\/preparations(?:\/|$)/, (route) => route.abort("connectionrefused"));
    await composeAndListen(page);
    const alert = page.getByTestId("speech-error");
    await expect(alert).toContainText("Speech server unreachable");
    // Nothing is playing and no other voice was substituted.
    await expect(page.getByRole("button", { name: /^Play/ })).toHaveAttribute("data-playing", "false");
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
    await alert.getByRole("button", { name: "Use browser voice" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("offline-banner")).toContainText("Speech server unreachable");
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });

  test("connection to the app drops → playback waits for it and resumes by itself", async ({ page, context }) => {
    const drop = (route: Route) => route.abort("connectionrefused");
    const lost = ["**/api/vs/**", /\/api\/preparations(?:\/|$)/, /\/\?reachable=/];
    for (const url of lost) await context.route(url, drop);
    await composeAndListen(page);
    const alert = page.getByTestId("speech-error");
    await expect(alert).toContainText("Can't reach ReadAloud. Playback resumes when the connection is back.");
    await expect(page.getByRole("button", { name: /^Play/ })).toHaveAttribute("data-playing", "false");
    for (const url of lost) await context.unroute(url, drop);
    // Nobody taps Retry: the next probe answers and the same passage is asked for again.
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    await expect(alert).toHaveCount(0);
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

  test("word timings flag adds a transcription request per passage and drives the underline", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("switch", { name: "Word timings from the server" }).click();
    let transcriptions = 0;
    page.on("request", (q) => { if (q.url().includes("/v1/audio/transcriptions")) transcriptions++; });
    await composeAndListen(page);
    await expect.poll(() => transcriptions, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    // A word in the active sentence carries the underline class once timings are in use
    await expect(page.locator('article [data-i="0"] span.decoration-accent').first()).toBeVisible();
  });

  test("saved-voice engine chips offer cloning engines and show the server's active one", async ({ page }) => {
    await page.goto("/settings");
    const group = page.getByRole("group", { name: "Saved-voice engine" });
    await expect(group.getByRole("button", { name: "OmniVoice", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "OmniVoice (isolated)" })).toHaveAttribute("aria-pressed", "false");
    // Preset-only engines can't speak saved voices, so they are not offered
    await expect(group.getByRole("button", { name: "KittenTTS" })).toHaveCount(0);
    // Cloning engines not installed on the server are counted in the note
    await expect(page.getByText(/1 more can be installed/)).toBeVisible();
    await expect(page.getByRole("switch", { name: "Browser voice only" })).toHaveAttribute("aria-checked", "false");
  });

  test("choosing a saved-voice engine switches the server and follows its answer", async ({ page }) => {
    let active = "omnivoice";
    const selected: string[] = [];
    await page.route(/\/api\/vs\/engines(\/select)?$/, async (route) => {
      if (route.request().url().endsWith("/select")) {
        active = JSON.parse(route.request().postData() ?? "{}").backend_id;
        selected.push(active);
        return route.fulfill({ json: { family: "tts", active } });
      }
      return route.fulfill({ json: { tts: { active, backends: [] } } });
    });
    await page.goto("/settings");
    const group = page.getByRole("group", { name: "Saved-voice engine" });
    await expect(group.getByRole("button", { name: "OmniVoice", exact: true })).toHaveAttribute("aria-pressed", "true");
    await group.getByRole("button", { name: "OmniVoice (isolated)" }).click();
    await expect(group.getByRole("button", { name: "OmniVoice (isolated)" })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "OmniVoice", exact: true })).toHaveAttribute("aria-pressed", "false");
    expect(selected).toEqual(["omnivoice-subprocess"]);
  });

  test("browser voice only reads without the server", async ({ page }) => {
    await composeAndListen(page);
    await page.keyboard.press("Space");
    await page.goto("/settings");
    await page.getByRole("switch", { name: "Browser voice only" }).click();
    await page.goto("/");
    await composeText(page, TEXT);
    let calls = 0;
    page.on("request", (q) => { if (q.url().includes("/v1/audio/speech")) calls++; });
    page.on("request", (q) => { if (q.url().endsWith("/api/preparations") && q.method() === "POST") calls++; });
    await page.getByTestId("listen").click();
    await page.waitForURL(/\/read\//);
    await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible();
    expect(calls).toBe(0); // local engine: no network at all
  });
});
