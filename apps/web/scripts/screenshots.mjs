import { chromium } from "@playwright/test";
const TEXT = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! How vexingly quick daft zebras jump? Sphinx of black quartz, judge my vow.\n\nA second paragraph keeps the reader honest. It has two sentences.";
const browser = await chromium.launch();
const sizes = { desktop: [1440, 900], tablet: [820, 1180], phone: [390, 844] };
for (const [name, [w, h]] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/arc-shots/${name}-compose.png` });
  await page.getByLabel("Text to read").fill(TEXT);
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\//);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/arc-shots/${name}-reader.png` });
  if (name === "desktop") {
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "More" }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `/tmp/arc-shots/${name}-reader-menu.png` });
    await page.keyboard.press("Escape");
    for (const p of ["library", "voices", "settings", "linux", "auth"]) {
      await page.goto(`http://127.0.0.1:4173/${p}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/arc-shots/${name}-${p}.png`, fullPage: p === "settings" });
    }
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("readaloud:settings")) ?? { state: {}, version: 1 }; s.state.theme = "light"; localStorage.setItem("readaloud:settings", JSON.stringify(s)); });
    await page.goto("http://127.0.0.1:4173/");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/arc-shots/${name}-compose-light.png` });
  }
  if (name === "phone") {
    await page.goto("http://127.0.0.1:4173/library");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/arc-shots/${name}-library.png` });
  }
  await ctx.close();
}
await browser.close();
