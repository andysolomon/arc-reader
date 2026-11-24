import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/** The last bundled Grades 6–8 passage, which a pinned Math.random always picks (and never NPR). */
const PASSAGE = "All children, except one, grow up. They soon know that they will grow up, and the way Wendy knew was this. One day when she was two years old she was playing in a garden, and she plucked another flower and ran with it to her mother. I suppose she must have looked rather delightful, for Mrs. Darling put her hand to her heart and cried, “Oh, why can’t you remain like this for ever!”";
const WORDS = PASSAGE.split(/\s+/).length;
/** What the speech server "heard": except → accept, Wendy → windy, garden → house, and no "another". */
const TRANSCRIPT = "All children, accept one, grow up. They soon know that they will grow up, and the way windy knew was this. One day when she was 2 years old she was playing in a house, and she plucked flower and ran with it to her mother. I suppose she must have looked rather delightful, for Mrs. Darling put her hand to her heart and cried, oh, why can't you remain like this forever?";

/** SHOTS=<dir> keeps a picture of each screen, to set beside the design boards. */
const SHOTS = process.env.SHOTS;
async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

const DAY = 86_400_000;
const day = (time: number) => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

async function seed(page: Page, state: Record<string, unknown> = {}) {
  await page.addInitScript((stored) => {
    Math.random = () => 0.99;
    if (!localStorage.getItem("cadence:practice")) localStorage.setItem("cadence:practice", stored);
  }, JSON.stringify({ version: 2, state: { band: "6-8", points: 0, streak: { days: 0, lastDay: null }, history: [], words: {}, readerId: "reader-1", readerName: "Andrew", others: {}, ...state } }));
}

interface Calls { urls: string[]; transcribe: string[]; speech: { voice: string; input: string }[] }

/** ReadAloud's API as the practice engine uses it: the transcript, the judge, word lookups and the voice. */
async function mockApi(page: Page, { segments = [] as { start: number; end: number; text: string }[] } = {}): Promise<Calls> {
  const calls: Calls = { urls: [], transcribe: [], speech: [] };
  const seen = (url: string) => calls.urls.push(new URL(url).pathname);
  await page.route("**/api/vs/transcribe", async (route) => {
    seen(route.request().url());
    calls.transcribe.push(route.request().postData()?.match(/name="mode"\r\n\r\n(\w+)/)?.[1] ?? "");
    await route.fulfill({ json: { text: TRANSCRIPT, segments, language: "en" } });
  });
  await page.route("**/api/decide/v1/systemone", async (route) => {
    seen(route.request().url());
    await route.fulfill({ json: { answers: { phrasing: { type: "score", score: 2.1 }, expression: { type: "score", score: 1 }, pace: { type: "score", score: 2 } } } });
  });
  await page.route("**/api/llm/v1/chat/completions", async (route) => {
    seen(route.request().url());
    await route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      respelling: "GAHR-dn", ipa: "/ˈɡɑrdn/", partOfSpeech: "noun", meaning: "A piece of ground where flowers or vegetables are grown.",
      root: "Old North French gardin", rootMeaning: "enclosed ground", etymology: "English took it from Norman French in the 1300s.",
    }) } }] } });
  });
  await page.route("**/api/phonon/v1/audio/speech", async (route) => {
    seen(route.request().url());
    calls.speech.push(route.request().postDataJSON());
    // No clip: the browser's own voice takes over, silently here.
    await route.fulfill({ status: 503, json: { error: "no voice in tests" } });
  });
  return calls;
}

async function readAndStop(page: Page) {
  await page.getByRole("button", { name: "Start reading" }).click();
  await expect(page.getByText("Ready when you are")).toBeVisible();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("status", { name: /^Recording, \d+ seconds?$/ })).toBeVisible();
  await page.waitForTimeout(1200);
}

test("a round: read, get judged, practise the missed words, and find them in Words and History", async ({ page }) => {
  await seed(page);
  const calls = await mockApi(page);
  await page.goto("/");

  // Home: the next passage, the level, and nothing to practise yet.
  await expect(page.getByRole("heading", { name: "Practice" })).toBeVisible();
  const next = page.getByRole("region", { name: "Next passage" });
  await expect(next.getByRole("heading", { name: "Peter Pan" })).toBeVisible();
  await expect(next.getByText(`J. M. Barrie · ${WORDS} words · about 30 sec`)).toBeVisible();
  await expect(page.getByRole("radio", { name: "6–8" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Words to practise 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Last reading None yet" })).toBeVisible();
  await shot(page, "1-home");

  // Ready, then recording.
  await readAndStop(page);
  await expect(page.getByText(`0 of ${WORDS}`)).toBeVisible();
  await expect(page.getByText("Tap when you reach the end")).toBeVisible();
  await shot(page, "4-live");
  await page.getByRole("button", { name: "Stop recording" }).click();

  // Results: three marked words plus one unclear word (a name the transcript spelled its own way).
  await expect(page.getByText("Results", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clear, steady reading.");
  await expect(page.getByText(`Three words to practise · +${WORDS - 4} points`)).toBeVisible();
  const score = page.getByRole("region", { name: "Score" });
  await expect(score.getByRole("img", { name: /^9\d% accuracy$/ })).toBeVisible();
  await expect(score.getByText(`${WORDS - 4} of ${WORDS - 1}`)).toBeVisible();
  const fluency = page.getByRole("region", { name: "Fluency" });
  await expect(fluency.getByText("3 of 4")).toBeVisible();
  await expect(fluency.getByText("2 of 3")).toBeVisible();
  await expect(fluency.getByText("Steady")).toBeVisible();
  const take = page.getByRole("region", { name: "Your reading, word by word" });
  const marked = take.locator("button.mark");
  await expect(marked).toHaveCount(4);
  await expect(marked.nth(0)).toHaveAttribute("aria-label", "except: mispronounced");
  await expect(marked.nth(1)).toHaveAttribute("aria-label", "Wendy: unclear, not counted");
  await expect(marked.nth(2)).toHaveAttribute("aria-label", "garden: different word");
  await expect(marked.nth(3)).toHaveAttribute("aria-label", "another: skipped");
  await expect(take.getByText("One word was unclear, so it isn't counted. Tap a marked word to hear it and try again.")).toBeVisible();
  await shot(page, "6-results", true);
  // One fast transcript for the words; the judge heard the recording once.
  expect(calls.transcribe).toEqual(["fast"]);
  expect(calls.urls.filter((u) => u.endsWith("/decide/v1/systemone"))).toHaveLength(1);

  // A marked word opens its sheet: what was heard, how to say it, what it means. Escape closes it.
  await marked.nth(2).click();
  const sheet = page.getByRole("dialog", { name: "Practise garden" });
  await expect(sheet.getByText("Different word", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "garden" })).toBeVisible();
  await expect(sheet.getByText("It sounded like “house” here.")).toBeVisible();
  await expect(sheet.getByText("Say it: GAHR-dn")).toBeAttached();
  await expect(sheet.getByText("A piece of ground where flowers or vegetables are grown.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Try this word" })).toBeVisible();
  await shot(page, "7-word-details");
  // Hear it asks ReadAloud's voice for just the word.
  await sheet.getByRole("button", { name: "Hear it" }).click();
  await expect.poll(() => calls.speech.at(-1)).toMatchObject({ voice: "Easton", input: "garden" });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // The drill takes the three missed words one at a time.
  await page.getByRole("button", { name: "Practise 3 words" }).click();
  await expect(page.getByText("Word 1 of 3 · listen, then say just the word")).toBeVisible();
  const card = page.getByRole("region", { name: "Word to practise" });
  await expect(card.getByRole("heading", { name: "except" })).toBeVisible();
  await expect(card.getByText("Mispronounced", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: "0 of 3 clean reads" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await shot(page, "8-drill");
  await page.getByRole("button", { name: "Next word" }).click();
  await expect(card.getByRole("heading", { name: "garden" })).toBeVisible();
  await page.getByRole("button", { name: "Stop practising" }).last().click();
  await expect(page.getByText("Results", { exact: true })).toBeVisible();

  // Back home, the round shows in the progress rows, in Words and in History.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("img", { name: "1 day streak" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Words to practise 3" })).toBeVisible();
  await page.getByRole("button", { name: "Words", exact: true }).click();
  await expect(page.getByRole("tab", { name: "To practise · 3" })).toHaveAttribute("aria-selected", "true");
  const bank = page.getByRole("region", { name: "Words to practise" });
  await expect(bank.getByText("Missed once · today")).toHaveCount(3);
  await shot(page, "9-words");
  await bank.getByRole("button", { name: /^another/ }).click();
  await expect(page.getByRole("dialog", { name: "Practise another" }).getByText("Missed once", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Andrew · Grades 6–8")).toBeVisible();
  const readings = page.getByRole("region", { name: "Readings" });
  await expect(readings.getByText("Peter Pan")).toBeVisible();
  await expect(readings.getByText("Today · J. M. Barrie")).toBeVisible();
  await shot(page, "10-history");
  // A bundled passage can be read again from its row.
  await readings.getByRole("button", { name: /^Read again: Peter Pan/ }).click();
  await expect(page.getByText("Ready when you are")).toBeVisible();
  await expect(page.getByText("Peter Pan · J. M. Barrie")).toBeVisible();
});

test("while recording, the passage follows the reader and marks a miss", async ({ page }) => {
  await seed(page);
  await mockApi(page, { segments: [
    { start: 0, end: 2, text: "All children, accept one, grow up." },
    { start: 2, end: 4, text: "They soon know that they will grow up, and the way" },
  ] });
  await page.goto("/");
  await readAndStop(page);
  // The first sentence is settled, with its miss marked; the cursor is further on.
  await expect(page.locator('[data-live-mark="mispronounced"]')).toHaveText("except", { timeout: 15_000 });
  await expect(page.locator("[data-live-cursor]")).not.toHaveAttribute("data-live-cursor", "0");
  await shot(page, "4-live-marked");
});

test("a reading that isn't the passage is not scored, and judging can be cancelled", async ({ page }) => {
  await seed(page);
  await page.route("**/api/vs/transcribe", (route) => route.fulfill({ json: { text: "Something else entirely.", segments: [] } }));
  // The judge answers only when the test lets it, so "Listening…" stays up to be seen and cancelled.
  const hold = () => { let release = () => {}; const held = new Promise<void>((resolve) => { release = resolve; }); return { held, release }; };
  let judge = hold();
  await page.route("**/api/decide/v1/systemone", async (route) => {
    await judge.held;
    await route.fulfill({ json: { answers: { phrasing: { score: 2 }, expression: { score: 1 }, pace: { score: 2 } } } }).catch(() => undefined);
  });
  await page.goto("/");
  await readAndStop(page);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Listening to your reading…")).toBeVisible();
  await shot(page, "5-judging");
  judge.release();
  await expect(page.getByText("That recording didn't match the passage, so it wasn't scored.")).toBeVisible();
  await expect(page.getByText("Ready when you are")).toBeVisible();

  // Cancel while the judge is still listening goes back to the passage.
  judge = hold();
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Ready when you are")).toBeVisible();
  judge.release();
  await expect(page.getByText("Results", { exact: true })).toHaveCount(0);
});

test("readers keep separate progress: add, switch, rename and remove", async ({ page }) => {
  const now = Date.now();
  await seed(page, {
    points: 1240, streak: { days: 4, lastDay: day(now) },
    others: {
      maya: { name: "Maya", band: "9-12", points: 310, streak: { days: 2, lastDay: day(now - DAY) }, history: [], words: {} },
      guest: { name: "Guest", band: "6-8", points: 40, streak: { days: 0, lastDay: null }, history: [], words: {} },
    },
  });
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("img", { name: "4 days streak" })).toBeVisible();
  await page.getByRole("button", { name: "Reading as Andrew. Change reader" }).click();
  const sheet = page.getByRole("dialog", { name: "Readers" });
  await expect(sheet.getByRole("radio", { name: /Andrew 4-day streak · 1,240 points/ })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("radio", { name: /Maya 2-day streak · 310 points/ })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /Guest 40 points/ })).toBeVisible();
  await shot(page, "2-readers");

  // Removing asks twice.
  const guest = sheet.locator(".reader").filter({ hasText: "Guest" });
  await guest.getByRole("button", { name: "Remove" }).click();
  await guest.getByRole("button", { name: "Remove?" }).click();
  await expect(sheet.getByRole("radio", { name: /Guest/ })).toHaveCount(0);

  await sheet.getByRole("button", { name: "Rename" }).click();
  await sheet.getByLabel("Reader's name", { exact: true }).fill("Andy");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("radio", { name: /Andy/ })).toHaveAttribute("aria-checked", "true");

  // Switching brings the other reader's level and streak.
  await sheet.getByRole("radio", { name: /Maya/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reading as Maya. Change reader" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "9–12" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("img", { name: "2 days streak" })).toBeVisible();

  // A new reader starts from nothing and becomes current.
  await page.getByRole("button", { name: "Reading as Maya. Change reader" }).click();
  await page.getByLabel("New reader's name").fill("Sam");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("button", { name: "Reading as Sam. Change reader" })).toBeVisible();
  await expect(page.getByRole("img", { name: "No streak yet" })).toBeVisible();
});

test("the level menu brings a passage at the new level", async ({ page }) => {
  await seed(page);
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start reading" }).click();
  await shot(page, "3-ready");
  await page.getByRole("button", { name: "Level: Grades 6–8. Change level" }).click();
  const sheet = page.getByRole("dialog", { name: "Level" });
  await sheet.getByRole("radio", { name: /Advanced/ }).click();
  await expect(page.getByRole("button", { name: "Level: Advanced. Change level" })).toBeVisible();
  await expect(page.getByText("All children, except one, grow up.")).toHaveCount(0);
  await expect(page.locator("p.passage")).not.toHaveText("Finding a passage…");
});

test("served under /cadence/ as well: pages, assets and API calls stay under the path", async ({ page }) => {
  await seed(page);
  const calls = await mockApi(page);
  // Without the trailing slash the server sends the browser to the path that relative addresses need.
  await page.goto("/cadence");
  await expect(page).toHaveURL(/\/cadence\/$/);
  await expect(page.getByRole("heading", { name: "Practice" })).toBeVisible();
  await readAndStop(page);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("Results", { exact: true })).toBeVisible();
  expect(calls.urls.length).toBeGreaterThan(0);
  for (const url of calls.urls) expect(url).toMatch(/^\/cadence\/api\//);
});

test("the public address needs the access token; the tailnet does not", async ({ request, baseURL }) => {
  const funnel = { "Tailscale-Funnel-Request": "?1" };
  // The tailnet: open.
  expect((await request.get("/")).status()).toBe(200);
  // Through Funnel: refused without the token, pages and API alike.
  const refused = await request.get("/cadence/", { headers: funnel });
  expect(refused.status()).toBe(401);
  expect(await refused.text()).toContain("This Cadence is private.");
  expect((await request.post("/cadence/api/decide/v1/systemone", { headers: funnel, data: {} })).status()).toBe(401);
  // The token sets the cookie and sends the browser back to the same place without it.
  const unlock = await request.get("/cadence/?access=e2e-access-token-e2e-access-token-0123", { headers: funnel, maxRedirects: 0 });
  expect(unlock.status()).toBe(303);
  expect(unlock.headers().location).toBe("./");
  const cookie = unlock.headers()["set-cookie"].split(";")[0];
  expect((await request.get(`${baseURL}/cadence/`, { headers: { ...funnel, cookie } })).status()).toBe(200);
});

test("only the practice engine's API routes are forwarded", async ({ request }) => {
  for (const path of ["/api/library", "/api/decide/config", "/api/vs/voices", "/api/fetch?url=https://example.com/"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

/** A phone (touch), and a desktop (mouse) with the sidebar and two-column screens. */
const SIZES = [
  { name: "phone", tap: "Tap", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  { name: "desktop", tap: "Click", use: { viewport: { width: 1440, height: 900 }, hasTouch: false } },
] as const;

for (const size of SIZES) test.describe(`on a ${size.name}`, () => {
  test.use(size.use);
  for (const colorScheme of ["light", "dark"] as const) test(`every screen passes the accessibility scan in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const now = Date.now();
    await seed(page, {
      points: 1240, streak: { days: 4, lastDay: day(now) },
      history: [{ at: now, passageId: "peter-pan-all-children", band: "6-8", accuracy: 94, wcpm: 133, phrasing: 3, points: 60 }],
      words: { rightful: { word: "rightful", missed: 1, clean: 0, lastAt: now }, hallow: { word: "hallow", missed: 1, clean: 3, lastAt: now } },
      others: { maya: { name: "Maya", band: "9-12", points: 310, streak: { days: 0, lastDay: null }, history: [], words: {} } },
    });
    await mockApi(page);
    const scan = async (screen: string) => expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => `${v.id}: ${v.nodes[0].html}`), screen).toEqual([]);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Peter Pan" })).toBeVisible();
    await scan("home");
    await page.getByRole("button", { name: "Reading as Andrew. Change reader" }).click();
    await scan("readers");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await scan("words");
    await page.getByRole("button", { name: /^rightful/ }).click();
    await expect(page.getByRole("dialog").getByText("A piece of ground")).toBeVisible();
    await scan("word details");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Mastered · 1" }).click();
    await scan("mastered words");
    await page.getByRole("tab", { name: "To practise · 1" }).click();
    await page.getByRole("button", { name: "Practise my words" }).click();
    await expect(page.getByRole("region", { name: "Word to practise" }).getByText("A piece of ground")).toBeVisible();
    await scan("word drill");
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await scan("history");
    await page.getByRole("button", { name: /^Read again: Peter Pan/ }).click();
    await scan("ready to read");
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByText(`${size.tap} when you reach the end`)).toBeVisible();
    await scan("reading, live");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByText("Results", { exact: true })).toBeVisible();
    await scan("results");
  });
});

test.describe("on a desktop", () => {
  test.use(SIZES[1].use);

  test("the tabs become a sidebar, and Home and Results use two columns", async ({ page }) => {
    await seed(page);
    await mockApi(page);
    await page.goto("/");
    const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;

    // A sidebar on the left with the app's name; the page beside it.
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByText("Cadence")).toBeVisible();
    const next = page.getByRole("region", { name: "Next passage" });
    await expect(next.getByRole("heading", { name: "Peter Pan" })).toBeVisible();
    const side = await box(nav);
    expect(side.height).toBe(900);
    expect(side.x + side.width).toBeLessThanOrEqual((await box(next)).x);
    const words = await box(nav.getByRole("button", { name: "Words" }));
    expect(words.y).toBeGreaterThan((await box(nav.getByRole("button", { name: "Read" }))).y);
    // The next passage, with the level and progress in a column beside it.
    const card = await box(next);
    const level = await box(page.getByRole("region", { name: "Level" }));
    expect(level.x).toBeGreaterThan(card.x + card.width);
    expect(Math.abs(level.y - card.y)).toBeLessThan(40);
    await shot(page, "desktop-1-home");

    await page.getByRole("button", { name: "Start reading" }).click();
    await expect(page.getByText("Click to record, then read aloud")).toBeVisible();
    await shot(page, "desktop-2-ready");
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Stop recording" }).click();

    // Results: the score on the left, the reading word by word on the right.
    await expect(page.getByText("Results", { exact: true })).toBeVisible();
    const take = page.getByRole("region", { name: "Your reading, word by word" });
    await expect(take.getByText("Click a marked word to hear it and try again.", { exact: false })).toBeVisible();
    const score = await box(page.getByRole("region", { name: "Score" }));
    const reading = await box(take);
    expect(reading.x).toBeGreaterThan(score.x + score.width);
    expect(Math.abs(reading.y - (await box(page.getByRole("heading", { level: 1 }))).y)).toBeLessThan(40);
    await shot(page, "desktop-3-results");

    // A word opens in a dialog in the middle of the screen rather than a sheet from the bottom.
    await take.locator("button.mark").nth(2).click();
    const dialog = page.getByRole("dialog", { name: "Practise garden" });
    await expect(dialog.getByText("A piece of ground")).toBeVisible();
    const sheet = await box(dialog);
    expect(sheet.width).toBeLessThanOrEqual(440);
    expect(Math.abs(sheet.y + sheet.height / 2 - 450)).toBeLessThan(4);
    expect(Math.abs(sheet.x + sheet.width / 2 - 720)).toBeLessThan(4);
    await shot(page, "desktop-4-word");
  });
});
