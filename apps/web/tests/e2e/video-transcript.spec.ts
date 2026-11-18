import { test, expect, type Page } from "./fixtures";
import { xPostHtml } from "../../vite.xpost";

const POST = "https://x.com/joseph_tsar_/status/2122750358493728998/video/1?s=46";
const SECONDS = 2186.617;
const WORDS = "There are only a few dozen people in the entire world who sit at this table.\n\nThey are what I like to call verbal athletes.";

/** The post as the server reads it from FxTwitter, with the video's transcription under the test's control. */
async function videoPost(page: Page, answers: { get: () => object; post: () => { status?: number; json: object } }) {
  await page.route("https://x.com/**", (route) => route.abort());
  await page.route("**/api/fetch?**", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: xPostHtml({
      text: "Full Course on How To Be Articulate (by Joseph Tsar)",
      author: { name: "Joseph Tsar", screen_name: "joseph_tsar_" },
      media: { videos: [{ url: "https://video.twimg.com/amplify_video/1/vid/avc1/480x270/small.mp4", duration: SECONDS, type: "video" }] },
    }),
  }));
  const asked: string[] = [];
  await page.route("**/api/transcribe?**", (route) => {
    asked.push(route.request().method());
    return route.request().method() === "POST" ? route.fulfill(answers.post()) : route.fulfill({ json: answers.get() });
  });
  await page.goto("/");
  await page.getByLabel("Link to read").evaluate((target, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, POST);
  await expect(page).toHaveURL(/\/read\/[a-z0-9-]+$/);
  return asked;
}

test("a post's video is transcribed into the reading", async ({ page }) => {
  let status: object = { state: "none", seconds: SECONDS };
  const asked = await videoPost(page, {
    get: () => status,
    post: () => { status = { state: "transcribing", seconds: SECONDS, done: 600 }; return { json: { state: "waiting", seconds: SECONDS, done: 0 } }; },
  });
  const article = page.locator("article");
  await expect(article).toContainText("Full Course on How To Be Articulate");
  const offer = page.getByRole("complementary", { name: "Video" });
  await expect(offer).toContainText("This post has a video that runs 36 minutes.");

  await offer.getByRole("button", { name: "Transcribe" }).click();
  const progress = page.locator("[data-transcript-progress]");
  await expect(progress).toContainText("Transcribing the video");
  await expect(progress).toContainText("10 of 37 min");
  await expect(offer).toHaveCount(0);

  status = { state: "done", seconds: SECONDS, text: WORDS };
  await expect(article.getByRole("heading", { name: "Transcript" })).toBeVisible();
  await expect(article).toContainText("They are what I like to call verbal athletes.");
  await expect(article).toContainText("Full Course on How To Be Articulate");
  await expect(page.getByRole("status").filter({ hasText: "Transcript added" })).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(offer).toHaveCount(0);

  // Saved with the document: a reload shows the transcript and asks the server nothing more.
  const before = asked.length;
  await page.reload();
  await expect(article).toContainText("They are what I like to call verbal athletes.");
  await expect(offer).toHaveCount(0);
  expect(asked.length).toBe(before);
  expect(asked.filter((method) => method === "POST")).toHaveLength(1);
});

test("a failed transcription says why and can be retried; the offer can be put off", async ({ page }) => {
  let attempts = 0;
  await videoPost(page, {
    get: () => ({ state: "none", seconds: 40 }),
    post: () => ++attempts === 1
      ? { status: 502, json: { error: { message: "The speech server couldn't be reached. Please retry." } } }
      : { json: { state: "done", seconds: 40, text: WORDS } },
  });
  const offer = page.getByRole("complementary", { name: "Video" });
  await expect(offer).toContainText("This post has a video that runs 40 seconds.");
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);

  // Back when the post is opened again.
  await page.reload();
  await offer.getByRole("button", { name: "Transcribe" }).click();
  await expect(offer.getByRole("alert")).toHaveText("The speech server couldn't be reached. Please retry.");
  await offer.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("article")).toContainText("They are what I like to call verbal athletes.");
  await expect(offer).toHaveCount(0);
});

test("a post without a video gets no offer", async ({ page }) => {
  await videoPost(page, { get: () => ({ state: "none" }), post: () => ({ status: 404, json: { error: { message: "That post has no video with sound." } } }) });
  await expect(page.locator("article")).toContainText("Full Course on How To Be Articulate");
  await expect(page.getByRole("complementary", { name: "Video" })).toHaveCount(0);
});
