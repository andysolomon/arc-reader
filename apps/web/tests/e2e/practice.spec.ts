import { test, expect, type Page } from "./fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

/** Grades 6–8 always uses the bundled passages, so no NPR or Jev request is involved. */
async function seed(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("readaloud:practice")) {
      localStorage.setItem("readaloud:practice", JSON.stringify({ state: { band: "6-8", points: 0, streak: { days: 0, lastDay: null }, history: [], words: {} }, version: 1 }));
    }
  });
}

type Requests = { body: { model: string; questions: Record<string, unknown>; state: unknown[] } }[];

/** A judge that marks word 2 mispronounced, 5 a different word, 7 skipped, and is unsure about 9. */
async function mockJudge(page: Page, { status = 200, offScript = 0.02 } = {}): Promise<Requests> {
  const requests: Requests = [];
  await page.route("**/api/decide/v1/systemone", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ body });
    if (status !== 200) return route.fulfill({ status, json: { error: { message: "Add your OpenCode key in Settings → Summaries to check readings." } } });
    const answers: Record<string, unknown> = {};
    for (const key of Object.keys(body.questions)) {
      if (key.startsWith("w")) answers[key] = { type: "choice", choice: "correct", confidence: 0.96 };
    }
    Object.assign(answers, {
      w_2: { choice: "mispronounced", confidence: 0.88 },
      w_5: { choice: "substituted", confidence: 0.91 },
      w_7: { choice: "skipped", confidence: 0.83 },
      w_9: { choice: "skipped", confidence: 0.52 },
      phrasing: { type: "score", score: 2.1 },
      expression: { type: "score", score: 1 },
      pace: { type: "score", score: 2 },
      off_script: { type: "noul", noul: offScript },
    });
    await route.fulfill({ json: { model: "gemini-decision-1", answers } });
  });
  return requests;
}

async function readAndStop(page: Page) {
  await page.getByRole("button", { name: "Start reading" }).click();
  const card = page.getByRole("region", { name: "Passage" });
  await expect(card.getByText("Public domain ·")).toBeVisible();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording ·" })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
}

test("a round: read, get judged, see marked words, keep missed words", async ({ page }) => {
  await seed(page);
  const requests = await mockJudge(page);
  await page.goto("/practice");
  await expect(page.getByRole("heading", { name: "Practice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("radio", { name: /Grades 6–8/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Words to practise")).toHaveCount(0);

  await readAndStop(page);
  await expect(page.getByText(/Listening to your reading|Clear|Mostly|good attempt/).first()).toBeVisible();

  // Results: three marked words plus one unclear word.
  await expect(page.getByText(/\+\d+ points · day 1 of your streak/)).toBeVisible();
  const marked = page.getByRole("region", { name: "Passage" }).locator("button[aria-expanded]");
  await expect(marked).toHaveCount(4);
  await expect(marked.nth(0)).toHaveAttribute("aria-label", /: mispronounced$/);
  await expect(marked.nth(1)).toHaveAttribute("aria-label", /: different word$/);
  await expect(marked.nth(3)).toHaveAttribute("aria-label", /: unclear$/);
  const score = page.getByRole("region", { name: "Score" });
  await expect(score.getByRole("img", { name: "3 of 4" })).toBeVisible();
  await expect(score.getByText("One word was unclear in the recording")).toBeVisible();
  await expect(page.getByRole("button", { name: "Practise 3 words" })).toBeVisible();

  // The judge got the audio and one question per word plus the four passage-wide ones.
  const sent = requests[0].body;
  expect(sent.model).toBe("gemini-decision-1");
  expect(sent.state[1]).toMatchObject({ type: "input_audio", input_audio: { format: "wav" } });
  const wordQuestions = Object.keys(sent.questions).filter((k) => k.startsWith("w_")).length;
  await expect(score.getByText(`${wordQuestions - 4} of ${wordQuestions - 1} words`)).toBeVisible();

  // A marked word opens its popover; Esc closes it.
  await marked.nth(1).click();
  const popover = page.getByRole("dialog");
  await expect(popover.getByText("Different word", { exact: true })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Hear it" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Try this word" })).toBeVisible();
  await expect(marked.nth(1)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);

  // Progress survives a reload: streak, and the three missed words (not the unclear one).
  await page.reload();
  await expect(page.getByText("1-day streak")).toBeVisible();
  const bank = page.getByRole("region", { name: "Words to practise" });
  await expect(bank.getByText("3 to go")).toBeVisible();
  await expect(bank.getByText("Missed once")).toHaveCount(3);
});

test("a missing OpenCode key points to Settings and keeps the passage", async ({ page }) => {
  await seed(page);
  await mockJudge(page, { status: 503 });
  await page.goto("/practice");
  await readAndStop(page);
  await expect(page.getByRole("alert")).toContainText("Add your OpenCode key in Settings");
  await expect(page.getByRole("alert").getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
});

test("an off-script take isn't scored", async ({ page }) => {
  await seed(page);
  await mockJudge(page, { offScript: 0.9 });
  await page.goto("/practice");
  await readAndStop(page);
  await expect(page.getByText("didn't match the passage")).toBeVisible();
  await expect(page.getByRole("region", { name: "Score" })).toHaveCount(0);
});

test("the phone tab bar keeps 44 px links on a 360 px phone, and Settings links the Linux client", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/practice");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const capsule = nav.locator("> div");
  const widths = await capsule.getByRole("link").evaluateAll((links) => links.map((l) => l.getBoundingClientRect().width));
  expect(widths).toHaveLength(5);
  for (const w of widths) expect(w).toBeGreaterThanOrEqual(44);
  expect(await capsule.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(nav.getByRole("link", { name: "Linux client" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Set up the Linux client" }).click();
  await expect(page).toHaveURL(/\/linux$/);
});

test("on a wide screen the rail has Practice and no Linux client, which Settings links", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/practice");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Linux client" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Set up the Linux client" }).click();
  await expect(page).toHaveURL(/\/linux$/);
});
