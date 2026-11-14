import { test, expect, type Page } from "./fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

/** The last bundled Grades 6–8 passage, which a pinned Math.random always picks (and never NPR). */
const PASSAGE = "All children, except one, grow up. They soon know that they will grow up, and the way Wendy knew was this. One day when she was two years old she was playing in a garden, and she plucked another flower and ran with it to her mother. I suppose she must have looked rather delightful, for Mrs. Darling put her hand to her heart and cried, “Oh, why can’t you remain like this for ever!”";
const WORDS = PASSAGE.split(/\s+/).length;
/** What the speech server "heard": except → accept, Wendy → windy, garden → house, and no "another". */
const TRANSCRIPT = "All children, accept one, grow up. They soon know that they will grow up, and the way windy knew was this. One day when she was 2 years old she was playing in a house, and she plucked flower and ran with it to her mother. I suppose she must have looked rather delightful, for Mrs. Darling put her hand to her heart and cried, oh, why can't you remain like this forever?";

async function seed(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0.99;
    if (!localStorage.getItem("readaloud:practice")) {
      localStorage.setItem("readaloud:practice", JSON.stringify({ state: { band: "6-8", points: 0, streak: { days: 0, lastDay: null }, history: [], words: {} }, version: 1 }));
    }
  });
}

interface Calls { decide: { model: string; questions: Record<string, unknown>; state: unknown[] }[]; transcribe: string[] }

/** The two halves of the judge: the speech server's transcript, and Gemini's levels for how it was read. */
async function mockJudge(page: Page, { decideStatus = 200, transcript = TRANSCRIPT, transcribeStatus = 200 } = {}): Promise<Calls> {
  const calls: Calls = { decide: [], transcribe: [] };
  await page.route("**/api/vs/transcribe", async (route) => {
    calls.transcribe.push(route.request().postData()?.match(/name="mode"\r\n\r\n(\w+)/)?.[1] ?? "");
    if (transcribeStatus !== 200) return route.fulfill({ status: transcribeStatus, json: { detail: "The recognizer isn't installed." } });
    await route.fulfill({ json: { text: transcript, segments: [], language: "en" } });
  });
  await page.route("**/api/decide/v1/systemone", async (route) => {
    calls.decide.push(route.request().postDataJSON());
    if (decideStatus !== 200) return route.fulfill({ status: decideStatus, json: { error: { message: "Add a Gemini API key in Settings → Practice to check readings." } } });
    await route.fulfill({ json: { answers: { phrasing: { type: "score", score: 2.1 }, expression: { type: "score", score: 1 }, pace: { type: "score", score: 2 } } } });
  });
  return calls;
}

async function readAndStop(page: Page) {
  await page.getByRole("button", { name: "Start reading" }).click();
  const card = page.getByRole("region", { name: "Passage" });
  await expect(card.getByText("Public domain ·")).toBeVisible();
  await expect(card.getByText("All children, except one, grow up.")).toBeVisible();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording ·" })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
}

test("a round: read, get judged, see marked words, keep missed words", async ({ page }) => {
  await seed(page);
  const calls = await mockJudge(page);
  await page.goto("/practice");
  await expect(page.getByRole("heading", { name: "Practice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("radio", { name: /Grades 6–8/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Words to practise")).toHaveCount(0);

  await readAndStop(page);

  // Results: three marked words plus one unclear word (a name the transcript spelled its own way).
  await expect(page.getByText(/\+\d+ points · day 1 of your streak/)).toBeVisible();
  const marked = page.getByRole("region", { name: "Passage" }).locator("button[aria-expanded]");
  await expect(marked).toHaveCount(4);
  await expect(marked.nth(0)).toHaveAttribute("aria-label", "except: mispronounced");
  await expect(marked.nth(1)).toHaveAttribute("aria-label", "Wendy: unclear");
  await expect(marked.nth(2)).toHaveAttribute("aria-label", "garden: different word");
  await expect(marked.nth(3)).toHaveAttribute("aria-label", "another: skipped");
  const score = page.getByRole("region", { name: "Score" });
  await expect(score.getByText(`${WORDS - 4} of ${WORDS - 1} words`)).toBeVisible();
  await expect(score.getByRole("img", { name: "3 of 4" })).toBeVisible();
  await expect(score.getByText("One word was unclear in the recording")).toBeVisible();
  await expect(page.getByRole("button", { name: "Practise 3 words" })).toBeVisible();

  // The words came from one fast transcript; Gemini was only asked how the passage was read.
  expect(calls.transcribe).toEqual(["fast"]);
  expect(calls.decide).toHaveLength(1);
  expect(calls.decide[0].model).toBe("gemini-decision-1");
  expect(calls.decide[0].state[1]).toMatchObject({ type: "input_audio", input_audio: { format: "wav" } });
  expect(Object.keys(calls.decide[0].questions)).toEqual(["phrasing", "expression", "pace"]);

  // A marked word opens its popover, which says what was heard; Esc closes it.
  await marked.nth(2).click();
  const popover = page.getByRole("dialog");
  await expect(popover.getByText("Different word", { exact: true })).toBeVisible();
  await expect(popover.getByText("It sounded like “house” here.")).toBeVisible();
  await expect(popover.getByRole("button", { name: "Hear it" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Try this word" })).toBeVisible();
  await expect(marked.nth(2)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);

  // Progress survives a reload: streak, and the three missed words (not the unclear one).
  await page.reload();
  await expect(page.getByText("1-day streak")).toBeVisible();
  const bank = page.getByRole("region", { name: "Words to practise" });
  await expect(bank.getByText("3 to go")).toBeVisible();
  await expect(bank.getByText("Missed once")).toHaveCount(3);
});

test("without a Gemini key the words are still scored, and Settings is linked for the rest", async ({ page }) => {
  await seed(page);
  await mockJudge(page, { decideStatus: 503 });
  await page.goto("/practice");
  await readAndStop(page);
  const score = page.getByRole("region", { name: "Score" });
  await expect(score.getByText(`${WORDS - 4} of ${WORDS - 1} words`)).toBeVisible();
  await expect(score.getByText("Phrasing, expression and pace weren't checked this time.")).toBeVisible();
  await expect(score.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await expect(score.getByRole("img", { name: "3 of 4" })).toHaveCount(0);
});

test("a speech server that can't transcribe says so and keeps the passage", async ({ page }) => {
  await seed(page);
  await mockJudge(page, { transcribeStatus: 409 });
  await page.goto("/practice");
  await readAndStop(page);
  await expect(page.getByRole("alert")).toContainText("The speech server couldn't check the reading: The recognizer isn't installed.");
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Score" })).toHaveCount(0);
});

test("an off-script take isn't scored", async ({ page }) => {
  await seed(page);
  await mockJudge(page, { transcript: "Thank you for watching." });
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

test("practising words: the missed words after a round, then the word bank", async ({ page }) => {
  await seed(page);
  await mockJudge(page);
  await page.goto("/practice");
  await readAndStop(page);
  await page.getByRole("button", { name: "Practise 3 words" }).click();
  await expect(page.getByText("Word 1 of 3 · listen, then say just the word")).toBeVisible();
  const card = page.getByRole("region", { name: "Word to practise" });
  await expect(card.getByText("Mispronounced", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Try this word" })).toBeVisible();
  await page.getByRole("button", { name: "Next word" }).click();
  await expect(card.getByText("Different word", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous word" }).click();
  await expect(page.getByText("Word 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Next word" }).click();
  await page.getByRole("button", { name: "Next word" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("region", { name: "Score" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Practise my words" }).click();
  await expect(page.getByText("Word 1 of 3")).toBeVisible();
  await expect(page.getByRole("region", { name: "Word to practise" }).getByText("Missed once")).toBeVisible();
  await page.getByRole("button", { name: "Stop practising" }).click();
  await expect(page.getByRole("button", { name: "Start reading" })).toBeVisible();
});

test("readers keep separate progress", async ({ page }) => {
  await seed(page);
  await mockJudge(page);
  await page.goto("/practice");
  await readAndStop(page);
  await expect(page.getByRole("region", { name: "Score" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Reading as Reader")).toBeVisible();
  await expect(page.getByRole("region", { name: "Words to practise" })).toBeVisible();

  await page.getByRole("button", { name: "Change reader" }).click();
  const dialog = page.getByRole("dialog", { name: "Readers" });
  await dialog.getByLabel("New reader's name").fill("Maya");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Reading as Maya")).toBeVisible();
  await expect(page.getByRole("region", { name: "Words to practise" })).toHaveCount(0);
  await expect(page.getByText("1-day streak")).toHaveCount(0);

  await page.getByRole("button", { name: "Change reader" }).click();
  await expect(dialog.getByRole("radio", { name: /Maya/ })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: /Reader/ }).click();
  await expect(page.getByText("Reading as Reader")).toBeVisible();
  await expect(page.getByText("1-day streak")).toBeVisible();
  await expect(page.getByRole("region", { name: "Words to practise" })).toBeVisible();
});

test("Grades 6–8 can get an NPR passage rewritten for the level", async ({ page }) => {
  const ORIGINAL = "Federal regulators on Thursday proposed sweeping restrictions on chemicals in consumer packaging, a move that industry groups warned could raise costs for manufacturers already contending with inflation. The proposal would phase out the substances over five years, following mounting evidence linking long-term exposure to elevated risks of certain cancers. Officials will take public comments until March.";
  const REWRITE = "On Thursday, officials proposed new rules for packaging. The rules target some chemicals in boxes and wrappers. The chemicals would be removed over five years. Long-term contact may raise the risk of some cancers. Some industry groups say the change could raise costs. Many companies already face rising prices. People can comment on the plan until March.";
  await seed(page);
  await page.addInitScript(() => { Math.random = () => 0.1; });
  await page.route("**/api/fetch?**", async (route) => {
    const url = new URL(route.request().url()).searchParams.get("url");
    if (url === "https://text.npr.org/1001") return route.fulfill({ body: '<a class="topic-title" href="/nx-s1-9">Packaging rules</a>' });
    return route.fulfill({ body: `<h1 class="story-title">EPA proposes packaging rules</h1><div class="paragraphs-container"><p>${ORIGINAL}</p></div>` });
  });
  await page.route("**/api/jev/v1/systemone", async (route) => {
    const passage = route.request().postDataJSON().state.passage as string;
    const level = passage.startsWith("On Thursday") ? "6-8" : "9-12";
    await route.fulfill({ json: { answers: { level: { choice: level, confidence: 0.9 }, unsuitable: { noul: 0.02 } } } });
  });
  const rewrites: unknown[] = [];
  await page.route("**/api/llm/v1/chat/completions", async (route) => {
    rewrites.push(route.request().postDataJSON());
    await route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: REWRITE } }] } });
  });
  await page.goto("/practice");
  await page.getByRole("button", { name: "Start reading" }).click();
  const card = page.getByRole("region", { name: "Passage" });
  await expect(card.getByText("Adapted from NPR ·")).toBeVisible();
  await expect(card.getByText(REWRITE)).toBeVisible();
  await expect(card.getByRole("link", { name: "EPA proposes packaging rules" })).toHaveAttribute("href", "https://www.npr.org/nx-s1-9");
  expect(rewrites).toHaveLength(1);
});
