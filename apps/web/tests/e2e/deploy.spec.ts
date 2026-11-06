import { test, expect } from "./fixtures";

test("a page whose bundle is gone after a deploy reloads itself instead of staying blank", async ({ page }) => {
  let missing = 0;
  // The first request for the entry bundle fails, as when a cached page outlives a deploy.
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    if (missing++ === 0) return route.fulfill({ status: 404, body: "Not found" });
    await route.fallback();
  });
  await page.goto("/");
  await expect(page.getByLabel("Text to read")).toBeVisible();
  expect(missing).toBeGreaterThan(1);
});

test("a bundle that keeps failing does not reload forever", async ({ page }) => {
  let requests = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => { requests++; return route.fulfill({ status: 404, body: "Not found" }); });
  await page.goto("/");
  await expect.poll(() => requests).toBe(2);
  await page.waitForTimeout(1000);
  expect(requests).toBe(2);
});

test("an old bundle served the HTML fallback also recovers", async ({ page }) => {
  let requests = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    if (requests++ === 0) {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ReadAloud</title>" });
    }
    await route.fallback();
  });
  await page.goto("/");
  await expect(page.getByLabel("Text to read")).toBeVisible();
  expect(requests).toBeGreaterThan(1);
});

test("blocked session storage cannot cause an endless recovery reload", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
  });
  let requests = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => {
    requests++;
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("/");
  await page.waitForTimeout(1000);
  expect(requests).toBe(1);
});
