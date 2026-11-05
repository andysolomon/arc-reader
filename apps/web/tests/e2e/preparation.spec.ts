import { test, expect } from "@playwright/test";

test("composing automatically prepares all passages, continues with the page closed, and reuses audio on return", async ({ page, context }) => {
  const unique = Date.now().toString(36);
  const text = Array.from({ length: 12 }, (_, i) => `Passage ${i + 1} of reading ${unique} continues to render when the phone switches apps.`).join("\n\n");
  await page.goto("/");
  await page.getByLabel("Text to read").fill(text);
  // Stop the first page from observing the job or downloading its results.
  // Rendering must continue independently of these browser requests.
  await page.route(/\/api\/preparations\/[a-f0-9-]+$/, (route) => route.abort("internetdisconnected"));
  const submitted = page.waitForResponse((r) => r.url().endsWith("/api/preparations") && r.request().method() === "POST");
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  const reader = page.url();
  const response = await submitted;
  expect(response.status()).toBe(202);
  const job = await response.json() as { id: string; state: string; total: number };
  expect(job.state).toBe("running");
  expect(job.total).toBe(12);
  await expect(page.getByRole("region", { name: "Player" })).toContainText("Preparing 0/12");
  await page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Pause/ }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("readaloud:preparations") || "[]").some((j: { active: boolean }) => j.active));
  await page.close();

  await expect.poll(async () => (await (await context.request.get(`/api/preparations/${job.id}`)).json()).state).toBe("done");
  const status = await (await context.request.get(`/api/preparations/${job.id}`)).json();
  expect(status.done).toBe(12);
  let regenerated = 0;
  await context.route("**/api/vs/v1/audio/speech", (route) => { regenerated++; return route.abort("connectionrefused"); });
  const returned = await context.newPage();
  await returned.goto(reader);
  await expect(returned.getByText("Audio prepared — playback no longer waits on the server", { exact: true })).toBeVisible();
  await returned.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Play/ }).click();
  await expect(returned.getByRole("button", { name: /^Pause/ })).toBeVisible();
  await expect(returned.getByTestId("speech-error")).toHaveCount(0);
  expect(regenerated).toBe(0);
});

test("automatic preparation can be stopped from the player", async ({ page }) => {
  const job = { id: "auto-prepare", state: "running", done: 0, total: 3 };
  await page.route("**/api/preparations", (route) => route.fulfill({ status: 202, json: job }));
  await page.route(`**/api/preparations/${job.id}`, (route) => route.fulfill({ json: job }));
  await page.goto("/");
  await page.getByLabel("Text to read").fill("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.getByRole("region", { name: "Player" })).toContainText("Preparing 0/3");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const cancelled = page.waitForRequest((r) => r.url().endsWith(`/api/preparations/${job.id}`) && r.method() === "DELETE");
  await page.getByRole("menuitem", { name: "Stop preparing (0/3)", exact: true }).click();
  await cancelled;
  await expect(page.getByRole("region", { name: "Player" })).not.toContainText("Preparing");
});
