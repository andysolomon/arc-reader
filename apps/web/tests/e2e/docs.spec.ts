import { test, expect, type Page } from "./fixtures";
import { DOC_LINKS, docUrl } from "../../src/lib/docs";

// The docs Settings links to, as an iPhone shows them. The iPad tests at the end set their own size.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const DIAGRAMS = [
  { page: "readaloud-bpmn.html", shape: "#layer-nodes .el.task" },
  { page: "readaloud-sequence.html", shape: '[data-k="m"]' },
];

const scale = (page: Page) => page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.getElementById("root")!.getAttribute("transform")!)![1]));

async function tapMiddle(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test("every doc fits a phone's width under a bar that names it and leads back to Settings", async ({ page }) => {
  for (const d of DOC_LINKS) {
    await page.goto(docUrl(d.page));
    const bar = page.locator("[data-docs-bar]");
    await expect(bar.locator("[data-docs-title] > span"), d.page).toHaveText(d.title);
    await expect(bar.getByRole("link", { name: "Settings" }), d.page).toHaveAttribute("href", "/settings#how-it-works");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), d.page).toBe(390);
    // iOS zooms the page in on a field under 16px.
    const small = await page.evaluate(() => [...document.querySelectorAll("select")].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id));
    expect(small, d.page).toEqual([]);
  }
});

test("the bar's title opens another doc, and Settings comes back at the list of docs", async ({ page }) => {
  await page.goto(docUrl("readaloud-bpmn.html"));
  await page.locator("[data-docs-bar] select").selectOption({ label: "Sequence diagrams" });
  // The sequence page adds the diagram it shows to the address.
  await expect(page).toHaveURL(/\/docs\/readaloud-sequence\.html(#\w+)?$/);
  await page.locator("[data-docs-bar]").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings#how-it-works$/);
  await expect(page.getByRole("navigation", { name: "How it works" })).toBeInViewport();
});

for (const d of DIAGRAMS) {
  test(`${d.page}: the diagram fills the screen, with details in a sheet and the narration as a caption`, async ({ page }) => {
    await page.goto(docUrl(d.page));
    // The page itself doesn't scroll: the diagram is what moves.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
    // It opens at a size that can be read, not shrunk to fit.
    expect(await scale(page)).toBeGreaterThanOrEqual(0.7);

    const sheet = page.locator("#sheet");
    await expect(sheet).not.toHaveClass(/open/);
    await tapMiddle(page, d.shape);
    await expect(sheet).toHaveClass(/open/);
    await expect(page.locator("#peek")).not.toBeEmpty();
    await page.locator("#grab").tap();
    await expect(sheet).not.toHaveClass(/open/);

    await expect(page.locator("#say")).toBeHidden();
    await page.locator("#play").tap();
    await expect(page.locator("#stage #say")).toBeVisible();
    await expect(sheet).not.toHaveClass(/open/);
  });

  test(`${d.page}: two fingers zoom the diagram`, async ({ page, context }) => {
    await page.goto(docUrl(d.page));
    const before = await scale(page);
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: number[][]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    await touch("touchStart", [[160, 320]]);
    await touch("touchStart", [[160, 320], [230, 320]]);
    for (let i = 1; i <= 6; i++) await touch("touchMove", [[160 - i * 8, 320], [230 + i * 8, 320]]);
    await touch("touchEnd", []);
    await expect.poll(() => scale(page)).toBeGreaterThan(before * 1.5);
    // Lifting the fingers doesn't count as a tap on whatever was under them.
    await expect(page.locator("#sheet")).not.toHaveClass(/open/);
  });
}

test.describe("iPad", () => {
  const fits = async (page: Page, width: number) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    // iOS zooms the page in on a field under 16px.
    const small = await page.evaluate(() => [...document.querySelectorAll("select")].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id));
    expect(small).toEqual([]);
  };

  test.describe("held upright", () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false });

    for (const d of DIAGRAMS) {
      test(`${d.page}: the diagram fills the screen, with details in a sheet`, async ({ page }) => {
        await page.goto(docUrl(d.page));
        await fits(page, 820);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1180);
        const stage = (await page.locator("#stage").boundingBox())!;
        expect(stage.width).toBe(820);
        expect(stage.height).toBeGreaterThan(900);
        const sheet = page.locator("#sheet");
        await tapMiddle(page, d.shape);
        await expect(sheet).toHaveClass(/open/);
        // The sheet is a card over the diagram, not the width of the screen.
        expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(640);
      });
    }

    test("the other docs fit, with their sections in one row", async ({ page }) => {
      for (const d of DOC_LINKS) {
        await page.goto(docUrl(d.page));
        await fits(page, 820);
      }
      await page.goto(docUrl("kind-cluster-explainer.html"));
      expect((await page.locator(".toc").boundingBox())!.height).toBeLessThan(60);
    });
  });

  test.describe("on its side", () => {
    test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false });

    for (const d of DIAGRAMS) {
      test(`${d.page}: details stay beside the diagram, with controls a finger can hit`, async ({ page }) => {
        await page.goto(docUrl(d.page));
        await fits(page, 1180);
        const panel = (await page.locator("#sheet").boundingBox())!;
        expect(panel.width).toBe(360);
        expect(panel.x + panel.width).toBe(1180);
        for (const control of ["#play", "#step", "#scen", "#zfit", "#tabs button"]) {
          expect((await page.locator(control).first().boundingBox())!.height, control).toBeGreaterThanOrEqual(36);
        }
        // Two fingers zoom here too.
        const before = await scale(page);
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: number[][]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
        await touch("touchStart", [[300, 400]]);
        await touch("touchStart", [[300, 400], [380, 400]]);
        for (let i = 1; i <= 6; i++) await touch("touchMove", [[300 - i * 8, 400], [380 + i * 8, 400]]);
        await touch("touchEnd", []);
        await expect.poll(() => scale(page)).toBeGreaterThan(before * 1.5);
      });
    }
  });
});
