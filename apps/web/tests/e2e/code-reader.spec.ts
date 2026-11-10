import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { composeText } from "./helpers";

const source = 'A useful example.\n\n```javascript\nconst active = users.filter(user => user.active);\nconsole.log(active);\n```\n\nThe article continues here.';
const explanation = "This example selects active users and prints the resulting list.";

for (const width of [390, 1440]) {
  test(`code is explained, cached, and expandable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let summaries = 0;
    const spoken: string[] = [];
    await page.route("**/api/llm/v1/chat/completions", async (route) => {
      summaries++;
      const input = JSON.parse(route.request().postDataJSON().messages[1].content);
      await route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(Object.fromEntries(input.blocks.map((b: { id: string }) => [b.id, explanation]))) } }] } });
    });
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().endsWith("/v1/audio/speech")) spoken.push(request.postDataJSON().input);
      if (request.url().endsWith("/api/preparations")) spoken.push(...request.postDataJSON().requests.map((r: { text: string }) => r.text));
    });
    await page.goto("/");
    await composeText(page, source);
    await page.getByTestId("listen").click();
    await page.waitForURL(/\/read\/[a-z0-9-]+$/);
    const card = page.getByRole("region", { name: "Code example" });
    await expect(card).toContainText(explanation);
    await expect(card.locator("pre")).toBeHidden();
    await card.locator("[data-i]").click();
    await expect.poll(() => spoken.some((text) => text.includes(explanation))).toBe(true);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await card.getByText("View original code").click();
    await expect(card.locator("pre")).toBeVisible();
    await expect(card.locator("pre")).toContainText("console.log(active);");
    expect(spoken.join(" ")).not.toMatch(/console|const active|users\.filter/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
    expect(violations).toEqual([]);
    await page.reload();
    await expect(card).toContainText(explanation);
    expect(summaries).toBe(1);
  });
}

test("unavailable explanations skip code without sending it to speech", async ({ page }) => {
  const spoken: string[] = [];
  await page.route("**/api/llm/config", (route) => route.fulfill({ json: { configured: false } }));
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
      if (request.url().endsWith("/v1/audio/speech")) spoken.push(request.postDataJSON().input);
      if (request.url().endsWith("/api/preparations")) spoken.push(...request.postDataJSON().requests.map((r: { text: string }) => r.text));
  });
  await page.goto("/");
  await composeText(page, source);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  const card = page.getByRole("region", { name: "Code example" });
  await expect(card).toContainText("Skipped in audio");
  await card.locator("[data-i]").click();
  await expect.poll(() => spoken.some((text) => text.includes("skip the code"))).toBe(true);
  expect(spoken.join(" ")).not.toMatch(/console|const active|users\.filter/);
});
