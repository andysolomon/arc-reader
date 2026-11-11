import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PROBE_IMAGE, unreachablePage } from "../../vite.shell";

// The page the iOS shell shows when it cannot load the app from its server.
const SERVER = "https://app.test";
const icon = readFileSync(`public${PROBE_IMAGE}`);
const timing = { retryMs: 200, giveUpMs: 1500 };

test("the fallback page opens the app by itself once the server answers", async ({ page }) => {
  let up = false, checks = 0;
  await page.route(`${SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === PROBE_IMAGE) checks++;
    if (!up) return route.abort("internetdisconnected");
    if (url.pathname === PROBE_IMAGE) return route.fulfill({ contentType: "image/png", body: icon });
    await route.fulfill({ contentType: "text/html", body: "<h1>The app</h1>" });
  });
  await page.setContent(unreachablePage(SERVER, timing));
  await expect(page.getByRole("heading", { name: "Can’t reach ReadAloud" })).toBeVisible();
  // It keeps asking while the server is away, and stays put.
  await expect.poll(() => checks).toBeGreaterThan(2);
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();

  up = true;
  await expect(page.getByRole("heading", { name: "The app" })).toBeVisible();
});

test("a server that answers with an error while it restarts is not opened", async ({ page }) => {
  let checks = 0, opened = 0;
  await page.route(`${SERVER}/**`, async (route) => {
    if (new URL(route.request().url()).pathname === PROBE_IMAGE) checks++;
    else opened++;
    await route.fulfill({ status: 404, contentType: "text/plain", body: "404 page not found" });
  });
  await page.setContent(unreachablePage(SERVER, timing));
  await expect.poll(() => checks).toBeGreaterThan(2);
  expect(opened).toBe(0);
  await expect(page.getByRole("heading", { name: "Can’t reach ReadAloud" })).toBeVisible();
});

test("Try again gives up on a connection that hangs and offers the button again", async ({ page }) => {
  // Requests are never answered, as with a stale Tailscale connection.
  await page.route(`${SERVER}/**`, () => new Promise(() => {}));
  await page.setContent(unreachablePage(SERVER, timing));
  // Playwright cannot look at the page while the navigation is pending, so the page records what the button showed.
  await page.getByRole("button", { name: "Try again" }).evaluate((button: HTMLButtonElement) => {
    const shown: string[] = [];
    (window as unknown as { shown: string[] }).shown = shown;
    new MutationObserver(() => shown.push(`${button.textContent}${button.disabled ? " (disabled)" : ""}`)).observe(button, { childList: true, attributes: true });
    button.click();
  });
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Can’t reach ReadAloud" })).toBeVisible();
  const shown = await page.evaluate(() => (window as unknown as { shown: string[] }).shown);
  expect(shown).toContain("Connecting… (disabled)");
  expect(shown.at(-1)).toBe("Try again");
});
