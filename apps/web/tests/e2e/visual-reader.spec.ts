import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { composeText } from "./helpers";

const explanation = "The diagram shows a request moving from a client to a server, then to a database.";
const photoDescription = "The photograph shows a team working together around a table.";
const article = `<html><head><title>How requests travel</title></head><body><article>
  <p>We begin with a useful explanation of the process and the people who built it.</p>
  <figure><img data-src="/team.png" alt="Team working"><figcaption>A team at work.</figcaption></figure>
  <p>Next, the diagram explains how a request moves through the system.</p>
  <figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180" role="img"><title>Request flow</title><desc>A client calls the server, which reads from a database.</desc><rect width="600" height="180" fill="white"/><text x="20" y="90" fill="black" font-size="24">Client → Server → Database</text></svg><figcaption>Request processing.</figcaption></figure>
  <p>The article continues with an explanation of the result.</p>
</article></body></html>`;
// A small image is enough to exercise rendering; the vision response is deterministic in these tests.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

for (const width of [390, 1440]) {
  test(`fetches, describes, displays and caches article visuals at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const images: string[] = [];
    const spoken: string[] = [];
    await page.route("https://example.com/story", (route) => route.fulfill({ contentType: "text/html", headers: { "Access-Control-Allow-Origin": "*" }, body: article }));
    await page.route("https://example.com/team.png", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") }));
    await page.route("**/api/llm/v1/responses", (route) => {
      const input = route.request().postDataJSON();
      const src = input.input[0].content.find((part: { type: string }) => part.type === "input_image").image_url;
      images.push(src);
      return route.fulfill({ json: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: src.startsWith("data:image/png") ? explanation : photoDescription }] }] } });
    });
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().endsWith("/v1/audio/speech")) spoken.push(request.postDataJSON().input);
      if (request.url().endsWith("/api/preparations")) spoken.push(...request.postDataJSON().requests.map((r: { text: string }) => r.text));
    });
    // Pasted URL import uses the same fetch path as the composer and share target.
    // A phone opens on the Library, so Compose is asked for by name.
    await page.goto("/compose");
    await page.locator('[data-screen="compose"]').evaluate((target) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "https://example.com/story");
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await page.waitForURL(/\/read\/[a-z0-9-]+$/);
    const photo = page.getByRole("region", { name: "Image explanation" });
    const diagram = page.getByRole("region", { name: "Diagram explanation" });
    await expect(photo).toContainText(photoDescription);
    await expect(diagram).toContainText(explanation);
    expect(images).toHaveLength(2);
    expect(images).toContain("https://example.com/team.png");
    expect(images.some((src) => src.startsWith("data:image/png;base64,"))).toBe(true);
    await expect.poll(() => spoken.some((text) => text.includes(explanation))).toBe(true);
    expect(spoken.join(" ")).not.toMatch(/https:|data:image|<svg|readaloud-visual/);
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    if (await pause.count()) await pause.click();
    await diagram.getByText("View diagram", { exact: true }).click();
    await expect(diagram.getByRole("img", { name: "Request flow" })).toBeVisible();
    expect(await diagram.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.reload();
    await expect(diagram).toContainText(explanation);
    expect(images).toHaveLength(2);
  });
}

test("uses alt text without vision and keeps a broken image from interrupting reading", async ({ page }) => {
  await page.route("**/api/llm/config", (route) => route.fulfill({ json: { configured: false } }));
  await page.route("https://example.com/missing.png", (route) => route.fulfill({ status: 404, body: "missing" }));
  await page.goto("/");
  await composeText(page, "Before.\n\n![A red fox in a field](https://example.com/missing.png)\n\nThe article continues.");
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  const card = page.getByRole("region", { name: "Image explanation" });
  await expect(card).toContainText("Image description from the article: A red fox in a field");
  await card.getByText("View image", { exact: true }).click();
  await expect(card).toContainText("The original image is unavailable");
  await expect(page.locator("article")).toContainText("The article continues.");
});

test("opens the reading at once and fills in descriptions as they arrive", async ({ page }) => {
  let release!: () => void;
  const described = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://example.com/slow.png", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") }));
  await page.route("**/api/llm/v1/responses", async (route) => {
    await described;
    return route.fulfill({ json: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: photoDescription }] }] } });
  });
  await page.goto("/");
  await composeText(page, "Before.\n\n![Team working](https://example.com/slow.png)\n\nThe article continues.");
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  const card = page.getByRole("region", { name: "Image explanation" });
  await expect(card).toContainText("Image description from the article: Team working");
  await expect(page.getByText(/Preparing image and diagram descriptions/)).toHaveCount(0);
  release();
  await expect(card).toContainText(photoDescription);
  await page.reload();
  await expect(card).toContainText(photoDescription);
});
