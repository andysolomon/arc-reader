import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

async function mockStudio(page: Page) {
  const profiles = [{ id: "voice-1", name: "My narrator", kind: "clone", language: "English" }];
  const calls: { path: string; body: string }[] = [];
  await page.route("**/api/vs/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/vs", "");
    calls.push({ path, body: req.postData() || "" });
    let body: unknown;
    if (path === "/setup/status") body = { models_ready: true };
    else if (path === "/dictation/readiness") body = { ready: true };
    else if (path.startsWith("/models/licenses/details/")) body = { repo_id: path.split("/details/")[1], info: {}, acceptance: { accepted: true } };
    else if (path === "/engines") body = { tts: { active: "omnivoice", backends: [{ id: "omnivoice", supports_cloning: true }] } };
    else if (path === "/v1/audio/voices") body = { voices: profiles.map((p) => ({ ...p, type: "profile" })), engines: [{ id: "kittentts", available: true }] };
    else if (path === "/profiles" && req.method() === "GET") body = profiles;
    else if (path === "/profiles") { body = { id: "voice-2", name: "New voice", kind: req.postData()?.includes('name="vd_states"') ? "design" : "clone", language: "English" }; profiles.push(body as typeof profiles[0]); }
    else if (path === "/design/describe") body = { attrs: { Gender: "female", Pitch: "low pitch" }, instruct: "female, low pitch", unmatched: ["raspy"] };
    else if (path === "/archetypes") body = { total: 1, items: [{ id: "librarian", name: "The Librarian", language: "English", use_case: "narration", instruct: "female, low pitch, british accent" }] };
    else if (path.endsWith("/preview/state")) body = { source: "rendering", message: "Rendering" };
    else if (path === "/archetypes/librarian/use") body = { profile_id: "voice-1", name: "The Librarian" };
    else if (path === "/transcribe") body = { text: "Hello from the recording.", segments: [{ start: 0, end: 2.5, text: "Hello from the recording." }] };
    else if (path === "/dub/upload") body = { job_id: "dub-1", task_id: "prep-1" };
    else if (path.startsWith("/tasks/stream/")) return route.fulfill({ contentType: "text/event-stream", body: `data: {"type":"${path.endsWith("prep-1") ? "ready" : "done"}"}\n\n` });
    else if (path === "/dub/transcribe/dub-1" || path === "/dub/import-srt/dub-1") body = { segments: [{ id: 0, start: 0, end: 2.5, text: "Hello from the recording." }], source_lang: "en" };
    else if (path === "/dub/generate/dub-1") body = { task_id: "render-1" };
    else if (path.includes("/dub/media/")) return route.fulfill({ status: 404 });
    else return route.fallback();
    await route.fulfill({ json: body });
  });
  return calls;
}

test("clones an uploaded reference and reloads saved voices", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.goto("/studio/clone");
  await page.getByLabel("Voice name", { exact: true }).fill("New voice");
  await page.getByLabel("Reference audio or video").setInputFiles({ name: "reference.wav", mimeType: "audio/wav", buffer: Buffer.from("test") });
  await page.getByLabel("Words spoken").fill("The reference text");
  await page.getByRole("button", { name: "Save voice" }).click();
  await expect(page.getByRole("link", { name: "Choose New voice in Voices" })).toBeVisible();
  // One saved voice per recording: the button stays disabled until the clip or name changes.
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  expect(calls.filter((c) => c.path === "/profiles" && c.body)).toHaveLength(1);
  const call = calls.find((c) => c.path === "/profiles" && c.body);
  expect(call?.body).toContain('name="ref_audio"');
  expect(call?.body).toContain("The reference text");
  expect(call?.body).toContain("clone");
});

test("designs only recognized traits and shows unsupported words", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.goto("/studio/design");
  await page.getByLabel("Voice name", { exact: true }).fill("New voice");
  await page.getByLabel("Describe your voice").fill("A low-pitched raspy woman");
  await expect(page.getByRole("button", { name: "Save voice" })).toBeDisabled();
  await page.getByRole("button", { name: "Interpret description" }).click();
  await expect(page.getByText("Not supported by this model: raspy")).toBeVisible();
  await page.getByRole("button", { name: "Save voice" }).click();
  await expect(page.getByRole("link", { name: "Choose New voice in Voices" })).toBeVisible();
  expect(calls.find((c) => c.path === "/profiles" && c.body)?.body).toContain('name="vd_states"');
});

test("imports actual gallery recipes and searches the catalog", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.goto("/studio/gallery");
  await page.getByRole("button", { name: "Add to Voices" }).click();
  await expect(page.getByRole("button", { name: "Added", exact: true })).toBeDisabled();
  expect(calls.some((c) => c.path === "/archetypes/librarian/use")).toBe(true);
  await page.getByLabel("Search designed voices").fill("British");
  await expect.poll(() => calls.filter((c) => c.path === "/archetypes").length).toBeGreaterThan(1);
});

test("transcribes a file and saves edited text to Library", async ({ page }) => {
  await mockStudio(page);
  await page.goto("/studio/transcribe");
  await page.getByLabel("Audio or video file").setInputFiles({ name: "meeting.wav", mimeType: "audio/wav", buffer: Buffer.from("test") });
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Transcript", exact: true })).toHaveValue("Hello from the recording.");
  await page.getByRole("textbox", { name: "Transcript", exact: true }).fill("Edited meeting notes");
  await expect(page.getByRole("button", { name: "Download subtitles" })).toBeDisabled();
  await page.getByRole("button", { name: "Save to Library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText("meeting", { exact: true })).toBeVisible();
});

test("dubs a video through upload, script review and resumable render", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.goto("/studio/dub");
  await page.getByLabel("Video file", { exact: true }).setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("test") });
  await page.getByRole("button", { name: "Upload video" }).click();
  await expect(page.getByText("Video ready. Transcribe it or import subtitles.")).toBeVisible();
  await page.getByRole("button", { name: "Transcribe video" }).click();
  await page.getByLabel(/Line 1/).fill("A new script.");
  await page.getByRole("button", { name: "Render dubbed video" }).click();
  await expect(page.getByRole("link", { name: "Download video" })).toHaveAttribute("href", /lang=en/);
  const request = JSON.parse(calls.find((c) => c.path === "/dub/generate/dub-1")!.body);
  expect(request.segments[0]).toMatchObject({ profile_id: "voice-1", text: "A new script." });
  expect(request.segment_ids).toEqual(["0"]);
  await page.reload();
  await expect(page.getByRole("link", { name: "Download video" })).toBeVisible();
});

test("failed task streams never show a completed dub", async ({ page }) => {
  await mockStudio(page);
  await page.route("**/api/vs/tasks/stream/**", (route) => route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"error","error":"Video could not be decoded"}\n\n' }));
  await page.goto("/studio/dub");
  await page.getByLabel("Video file", { exact: true }).setInputFiles({ name: "bad.mp4", mimeType: "video/mp4", buffer: Buffer.from("test") });
  await page.getByRole("button", { name: "Upload video" }).click();
  await expect(page.getByRole("alert")).toContainText("Video could not be decoded");
  await expect(page.getByRole("link", { name: "Download video" })).toHaveCount(0);
});

test("Studio is accessible and fits a phone", async ({ page }) => {
  await mockStudio(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio/design");
  await expect(page.getByLabel("Voice name", { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("dictation records a complete clip and releases the microphone", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { testStream: MediaStream }).testStream = stream;
      return stream;
    };
  });
  await page.goto("/studio/dictate");
  await page.getByRole("button", { name: "Record microphone" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording ·" })).toBeVisible();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByRole("textbox", { name: "Transcript", exact: true })).toHaveValue("Hello from the recording.");
  expect(calls.find((c) => c.path === "/transcribe")?.body).toContain('name="dictation"');
  expect(await page.evaluate(() => (window as unknown as { testStream: MediaStream }).testStream.getTracks().every((t) => t.readyState === "ended"))).toBe(true);
});

test("microphone permission errors are actionable", async ({ page }) => {
  await mockStudio(page);
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Microphone permission denied", "NotAllowedError"); }; });
  await page.goto("/studio/dictate");
  await page.getByRole("button", { name: "Record microphone" }).click();
  await expect(page.getByRole("alert")).toContainText("Microphone permission denied");
});

test("license acceptance requires reviewing and checking each model", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.route("**/api/vs/models/licenses/details/**", (route) => route.fulfill({ json: { repo_id: "k2-fsa/OmniVoice", info: { license: "Noncommercial", notes: "Review required", evidence_url: "https://huggingface.co/k2-fsa/OmniVoice" }, acceptance: { accepted: false, fingerprint: "v2:reviewed", category: "noncommercial" } } }));
  await page.goto("/studio/design");
  await page.getByRole("button", { name: "Review model terms" }).click();
  await expect(page.getByRole("button", { name: "Accept terms for this model" }).first()).toBeDisabled();
  expect(calls.some((c) => c.path === "/models/licenses/accept")).toBe(false);
});

function previewWav(seconds = 1) {
  const wav = Buffer.alloc(44 + 16000 * 2 * seconds);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(32000 * seconds, 40);
  return wav;
}

test("preview waits for complete audio and picks up repaired clips when reopened", async ({ page }) => {
  await mockStudio(page);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let downloads = 0;
  await page.route("**/archetypes/librarian/preview/state", (route) => route.fulfill({ json: { source: "rendering", message: "Rendering" } }));
  await page.route("**/archetypes/librarian/preview", async (route) => { downloads++; await gate; await route.fulfill({ contentType: "audio/wav", body: previewWav(downloads) }); });
  await page.goto("/studio/gallery");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Generating preview" })).toContainText("first preview can take a minute");
  await expect(page.locator("audio")).toHaveCount(0);
  finish();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("status").filter({ hasText: "Preview ready" })).toBeVisible();
  await expect(page.getByRole("article", { name: "The Librarian" }).getByText("Preview ready", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(1);
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Play preview", exact: true }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(2);
  expect(downloads).toBe(2);
});

test("a generating preview survives navigating away and back", async ({ page }) => {
  await mockStudio(page);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let downloads = 0;
  await page.route("**/archetypes/librarian/preview/state", (route) => route.fulfill({ json: { source: "rendering", message: "Rendering" } }));
  await page.route("**/archetypes/librarian/preview", async (route) => { downloads++; await gate; await route.fulfill({ contentType: "audio/wav", body: previewWav() }); });
  await page.goto("/studio/gallery");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Generating preview" })).toBeVisible();
  await page.getByRole("link", { name: "Voices", exact: true }).first().click();
  await expect(page).toHaveURL(/\/voices/);
  await page.getByRole("link", { name: "Studio", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Generating preview" })).toBeVisible();
  await expect(page.getByRole("article", { name: "The Librarian" }).getByText("Generating preview…")).toBeVisible();
  finish();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("article", { name: "The Librarian" }).getByText("Preview ready", { exact: true })).toBeVisible();
  expect(downloads).toBe(1);
});

test("preview displays actual server errors and supports retry", async ({ page }) => {
  await mockStudio(page);
  await page.route("**/archetypes/librarian/preview/state", (route) => route.fulfill({ json: { source: "rendering", message: "Rendering" } }));
  let attempts = 0;
  await page.route("**/archetypes/librarian/preview", (route) => ++attempts === 1
    ? route.fulfill({ status: 403, json: { detail: { message: "Licence not accepted for OmniVoice" } } })
    : route.fulfill({ contentType: "audio/wav", body: previewWav() }));
  await page.goto("/studio/gallery");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Licence not accepted for OmniVoice");
  await expect(page.getByRole("article", { name: "The Librarian" }).getByText("Preview ready", { exact: true })).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a stalled preview stops waiting and offers retry", async ({ page }) => {
  await mockStudio(page);
  await page.clock.install();
  await page.route("**/archetypes/librarian/preview/state", (route) => route.fulfill({ json: { source: "rendering", message: "Rendering" } }));
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/archetypes/librarian/preview", async (route) => { await gate; await route.abort().catch(() => {}); });
  await page.goto("/studio/gallery");
  await page.clock.runFor(250);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Generating preview" })).toBeVisible();
  await page.clock.fastForward(180_001);
  await expect(page.getByRole("alert")).toContainText("taking longer than expected");
  await expect(page.getByRole("button", { name: "Retry preview" })).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  finish();
  await expect(page.locator("audio")).toHaveCount(0);
});

test("gallery marks cached and gallery previews without generating audio, including after reload", async ({ page }) => {
  const calls = await mockStudio(page);
  let source = "cached";
  await page.route("**/archetypes/librarian/preview/state", (route) => route.fulfill({ json: { source, message: "Ready" } }));
  await page.goto("/studio/gallery");
  const card = page.getByRole("article", { name: "The Librarian" });
  await expect(card.getByText("Preview ready", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Play preview" })).toBeVisible();
  await expect(card.getByLabel("Voice source: VoiceStudio")).toBeVisible();
  source = "gallery";
  await page.reload();
  await expect(card.getByText("Preview ready", { exact: true })).toBeVisible();
  source = "rendering";
  await page.reload();
  await expect(card.getByText("Not generated", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
  expect(calls.some((c) => c.path.endsWith("/preview"))).toBe(false);
});

test("preview status errors do not mark a voice ready or prevent previewing", async ({ page }) => {
  await mockStudio(page);
  await page.route("**/archetypes/librarian/preview/state", (route) => route.fulfill({ status: 503 }));
  await page.goto("/studio/gallery");
  const card = page.getByRole("article", { name: "The Librarian" });
  await expect(card.getByText("Preview status unavailable")).toBeVisible();
  await expect(card.getByRole("button", { name: "Preview", exact: true })).toBeEnabled();
  await expect(card.getByText("Preview ready", { exact: true })).toHaveCount(0);
});

test("Studio favorites persist, include other catalog pages, and can be searched and removed", async ({ page }) => {
  const calls = await mockStudio(page);
  await page.route("**/api/vs/archetypes?**", (route) => {
    const secondPage = new URL(route.request().url()).searchParams.get("offset") === "24";
    return route.fulfill({ json: { total: 25, items: [{ id: secondPage ? "neighbor" : "librarian", name: secondPage ? "The Neighbor" : "The Librarian", language: "English", use_case: "narration", instruct: secondPage ? "American accent" : "British accent" }] } });
  });
  await page.goto("/studio/gallery");
  await page.getByRole("button", { name: "Favorite The Librarian", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unfavorite The Librarian", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Favorite The Neighbor", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Favorites (2)", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByLabel("Search designed voices").fill("American");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "The Neighbor" })).toBeVisible();
  await page.getByLabel("Search designed voices").fill("");
  await page.getByRole("button", { name: "Unfavorite The Librarian", exact: true }).click();
  await page.getByRole("button", { name: "Unfavorite The Neighbor", exact: true }).click();
  await expect(page.getByText("No favorites yet. Star a voice in All voices to keep it here.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Favorites (0)", exact: true })).toBeVisible();
  expect(calls.some((c) => c.path.endsWith("/use") || c.path.endsWith("/preview"))).toBe(false);
});

test("Voices identifies each provider", async ({ page }) => {
  await mockStudio(page);
  await page.goto("/voices");
  await expect(page.locator('[data-voice="alloy"]').getByLabel("Voice source: ChatGPT")).toBeVisible();
  await expect(page.locator('[data-voice="voice-1"]').getByLabel("Voice source: VoiceStudio")).toBeVisible();
  await expect(page.locator('[data-voice="local"]').getByLabel("Voice source: Browser")).toBeVisible();
  for (const [heading, voice] of [["ChatGPT", "alloy"], ["VoiceStudio", "voice-1"], ["Browser", "local"]]) {
    await expect(page.getByRole("region", { name: heading }).locator(`[data-voice="${voice}"]`)).toBeVisible();
  }
});

test("gallery filters narrow the catalog and favorites", async ({ page }) => {
  await mockStudio(page);
  const queries: URLSearchParams[] = [];
  const librarian = { id: "librarian", name: "The Librarian", language: "English", use_case: "narration", instruct: "female, low pitch, british accent", attrs: {}, facets: { gender: "female", pitch: "low pitch", accent: "british accent", whisper: false, lang: "English" } };
  const guide = { id: "guide", name: "The Calm Guide", language: "English", use_case: "narration", instruct: "male, whisper", attrs: {}, facets: { gender: "male", whisper: true, lang: "English" } };
  await page.route("**/api/vs/archetypes?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params);
    const items = [librarian, guide].filter((v) => !params.get("gender") || v.facets.gender === params.get("gender"));
    return route.fulfill({ json: { total: items.length, items } });
  });
  await page.goto("/studio/gallery");
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByLabel("Gender").selectOption("male");
  await page.getByLabel("Accent").selectOption("british accent");
  await expect.poll(() => queries.at(-1)?.get("accent")).toBe("british accent");
  expect(queries.at(-1)?.get("gender")).toBe("male");
  await page.getByRole("button", { name: "Clear filters (2)" }).click();
  await expect.poll(() => queries.at(-1)?.has("gender")).toBe(false);
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("button", { name: "Favorite The Librarian", exact: true }).click();
  await page.getByRole("button", { name: "Favorite The Calm Guide", exact: true }).click();
  await page.getByRole("button", { name: "Favorites (2)", exact: true }).click();
  await page.getByLabel("Delivery").selectOption("true");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "The Calm Guide" })).toBeVisible();
  await page.getByLabel("Gender").selectOption("female");
  await expect(page.getByText("No voices match these filters.")).toBeVisible();
});

test("Voices filters by source, language, type and search", async ({ page }) => {
  await mockStudio(page);
  await page.goto("/voices");
  const cards = page.locator("[data-voice]");
  await expect(page.locator('[data-voice="voice-1"]')).toBeVisible();
  const total = await cards.count();
  await page.getByRole("group", { name: "Voice source" }).getByRole("button", { name: /^ChatGPT/ }).click();
  await expect(page.locator('[data-voice="alloy"]')).toBeVisible();
  await expect(page.locator('[data-voice="local"]')).toHaveCount(0);
  await page.getByLabel("Search voices").fill("podcast");
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "Clear filters (2)" }).click();
  await expect(cards).toHaveCount(total);
  await page.getByLabel("Type").selectOption("cloned");
  await expect(cards).toHaveCount(1);
  await expect(page.locator('[data-voice="voice-1"]')).toBeVisible();
  await page.getByLabel("Type").selectOption("");
  await page.getByLabel("Language").selectOption("MULTI");
  await expect(page.locator('[data-voice="local"]')).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `of ${total} voices` })).toBeVisible();
});

test("gallery favorites and preview indicators are accessible on a phone", async ({ page }) => {
  await mockStudio(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio/gallery");
  await page.getByRole("button", { name: "Favorite The Librarian", exact: true }).click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
