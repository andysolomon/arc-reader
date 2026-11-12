import { test, expect } from "./fixtures";
import { TEXT, composeText } from "./helpers";

test.describe("Phonon voices (stub server)", () => {
  test("lists the server's Phonon voices under their own service", async ({ page }) => {
    await page.goto("/voices");
    // The stub offers six catalogue voices, one the app has never heard of, and "default".
    await expect(page.locator('[data-voice^="phonon:"]')).toHaveCount(7);
    await expect(page.locator('[data-voice="phonon:Captain Silas Blackwater"]')).toBeVisible();
    await expect(page.locator('[data-voice="phonon:Newcomer"]')).toBeVisible();
    await expect(page.locator('[data-voice="phonon:default"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Phonon" })).toBeVisible();
  });

  test("previewing a Phonon voice goes straight to its own proxy", async ({ page }) => {
    await page.goto("/voices");
    const speech = page.waitForResponse((r) => r.url().includes("/api/phonon/v1/audio/speech") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Preview Hugh" }).click();
    const r = await speech;
    expect(r.status()).toBe(200);
    expect(JSON.parse(r.request().postData() ?? "{}")).toMatchObject({ model: "gradium/phonon-31m-en", voice: "Hugh", speed: 1, response_format: "mp3" });
    await expect.poll(() => page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem("readaloud:usage") ?? "{}").rows ?? [];
      return rows.filter((row: { provider: string }) => row.provider === "phonon").length;
    }), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("listening with a Phonon voice prepares the whole reading on the server's Phonon machine", async ({ page, context }) => {
    await page.goto("/voices");
    await page.locator('[data-voice="phonon:Hugh"]').getByRole("button", { name: "Use" }).click();
    await page.goto("/");
    const unique = Date.now().toString(36);
    await composeText(page, `${TEXT}\n\nA third paragraph makes a third passage of reading ${unique}.`);
    let voicestudio = 0;
    page.on("request", (q) => { if (q.url().includes("/api/vs/v1/audio/speech")) voicestudio++; });
    const submitted = page.waitForResponse((r) => r.url().endsWith("/api/preparations") && r.request().method() === "POST");
    await page.getByTestId("listen").click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const requests = JSON.parse(response.request().postData() ?? "{}").requests as { engine: string; voice: string; protocol: string }[];
    expect(requests).toHaveLength(3);
    expect(requests.every((item) => item.engine === "phonon" && item.voice === "phonon:Hugh" && item.protocol === "openai")).toBe(true);
    const job = await response.json() as { id: string };
    await expect(page.getByRole("button", { name: /^(Play|Pause)/ })).toHaveAttribute("data-playing", "true");
    await expect(page.getByText("Audio prepared — playback no longer waits on the server", { exact: true })).toBeVisible();
    expect(await (await context.request.get(`/api/preparations/${job.id}`)).json()).toMatchObject({ state: "done", done: 3, total: 3, worker: "Phonon" });
    // The reading is shared: any device can fetch it from the web server.
    const clip = await context.request.get(`/api/preparations/${job.id}/audio/2`);
    expect(clip.status()).toBe(200);
    expect(clip.headers()["content-type"]).toContain("audio/");
    expect(voicestudio).toBe(0);
    await expect(page.getByTestId("speech-error")).toHaveCount(0);
  });
});
