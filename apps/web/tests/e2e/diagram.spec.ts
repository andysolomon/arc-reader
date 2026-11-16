import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { composeAndListen } from "./helpers";

const FLOW = { type: "flow", title: "How the pangram is read", focus: 1, items: [
  { label: "Paste the text", note: "Any article or note" },
  { label: "Split into sentences", note: "Each is a listening target" },
  { label: "Speak each one" },
] };

/** Answers the diagram model with `replies` in turn; summaries still reach the stub server. */
async function diagramReplies(page: Page, replies: unknown[]) {
  const calls: { force: boolean }[] = [];
  await page.route("**/api/llm/v1/chat/completions", async (route) => {
    if (!route.request().headers()["x-opencode-session"]?.startsWith("readaloud-diagram-")) return route.continue();
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push({ force: body.messages[0].content.includes('do not return "none"') });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    await route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] } });
  });
  return calls;
}

test("draws a diagram once, keeps it across reloads, and deletes it", async ({ page }) => {
  const calls = await diagramReplies(page, [FLOW]);
  await composeAndListen(page);
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Draw a diagram" }).click();
  const panel = page.getByRole("region", { name: "Diagram" });
  await expect(panel).toContainText("How the pangram is read");
  const figure = panel.getByRole("img");
  await expect(figure).toHaveAttribute("aria-label", /A process in 3 steps\. First, Paste the text: Any article or note\./);
  await expect(figure).toContainText("Split into sentences");
  await expect(panel).toContainText("Check it against the article");

  // Saved on the document and the panel stays open, so a reload costs no new request.
  await page.reload();
  await expect(panel.getByRole("img")).toContainText("Speak each one");
  expect(calls).toHaveLength(1);

  await panel.getByRole("button", { name: "Delete diagram" }).click();
  await expect(panel).toContainText("See the article’s structure as a diagram.");
  await page.reload();
  await expect(panel).toContainText("See the article’s structure as a diagram.");
  await panel.getByRole("button", { name: "Hide diagram" }).click();
  await expect(panel).toHaveCount(0);
});

test("says why there is no diagram, and draws one anyway when asked", async ({ page }) => {
  const calls = await diagramReplies(page, [{ type: "none", reason: "It is one short sentence." }, FLOW]);
  await composeAndListen(page);
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Draw a diagram" }).click();
  const panel = page.getByRole("region", { name: "Diagram" });
  await expect(panel).toContainText("No diagram: It is one short sentence.");
  await panel.getByRole("button", { name: "Draw one anyway" }).click();
  await expect(panel.getByRole("img")).toContainText("Paste the text");
  expect(calls).toEqual([{ force: false }, { force: true }]);
});

test("lays the diagram out again for a phone's width", async ({ page }) => {
  await diagramReplies(page, [FLOW]);
  await composeAndListen(page);
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Draw a diagram" }).click();
  const figure = page.getByRole("region", { name: "Diagram" }).getByRole("img");
  await expect(figure).toBeVisible();
  // Three steps sit side by side on a wide screen and one under another on a narrow one.
  const rows = () => figure.locator("rect").evaluateAll((rects) => new Set(rects.map((r) => r.getAttribute("y"))).size);
  expect(await rows()).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(rows).toBe(3);
  const box = await figure.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
});
