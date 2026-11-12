import { test, expect } from "./fixtures";
import { DECK, DIAGRAM, buildPdf } from "../fixtures/pdf";

test("a PDF slide deck uploads as one section per slide", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "lecture06.pdf", mimeType: "application/pdf", buffer: buildPdf(DECK) });
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Agent Design" }).first()).toBeVisible();
  // The slide's title is drawn with a ligature glyph that only the file's replacement text spells out.
  await expect(page.getByRole("heading", { level: 2, name: "Design patterns" })).toBeVisible();
  await expect(page.getByText("Workflows chain model calls in a fixed order.")).toBeVisible();
  await expect(page.getByText("Agents choose their next step.")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Agent Design", exact: true })).toBeVisible();
  await expect(page.getByText("lecture06.pdf").first()).toBeVisible();
});

test("a scanned PDF with no text is turned away", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: buildPdf(["0 0 960 540 re f"]) });
  await expect(page.getByRole("status").filter({ hasText: "Couldn't read that PDF" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("a slide that shows a diagram comes with its picture, described for the listener", async ({ page }) => {
  const description = "Fifty boxes sit in five rows of ten, standing for the steps an agent repeats.";
  const asked: { image: string; instructions: string; about: { deck: string; slide: string; text: string } }[] = [];
  await page.route("**/api/llm/v1/responses", (route) => {
    const body = route.request().postDataJSON();
    asked.push({ image: body.input[0].content[1].image_url, instructions: body.instructions, about: JSON.parse(body.input[0].content[0].text) });
    return route.fulfill({ json: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: description }] }] } });
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "lecture06.pdf", mimeType: "application/pdf", buffer: buildPdf([...DECK, DIAGRAM]) });
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 2, name: "How an agent loops" })).toBeVisible();

  // Only the slide with something drawn on it gets a picture, served by this server.
  const slide = page.getByRole("region", { name: "Slide picture" });
  await expect(slide).toHaveCount(1);
  const picture = slide.getByRole("img", { name: "Slide 3: How an agent loops" });
  await expect(picture).toHaveAttribute("src", /^\/api\/slides\/[a-f0-9]{32}\/3\.jpg$/);
  await picture.scrollIntoViewIfNeeded();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);

  // Listening is what asks for the description; it takes the stand-in's place in the reading.
  await expect(slide).toContainText(description, { timeout: 30_000 });
  await expect(slide).toContainText("Spoken description");
  expect(asked).toHaveLength(1);
  expect(asked[0].image).toMatch(/^data:image\/jpeg;base64,\/9j\//);
  expect(asked[0].instructions).toContain("one slide from a lecture deck");
  expect(asked[0].about).toEqual({ deck: "Agent Design", slide: "Slide 3: How an agent loops", text: "" });

  // The description is kept with the document, so opening it again asks nothing.
  await page.reload();
  await expect(page.getByRole("region", { name: "Slide picture" })).toContainText(description);
  expect(asked).toHaveLength(1);
});
