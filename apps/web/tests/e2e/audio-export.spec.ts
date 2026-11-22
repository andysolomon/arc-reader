import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { test, expect } from "./fixtures";
import { composeText, prepareFromPlayer } from "./helpers";

test("prepared audio saves to a file, leaves the device, and loads back", async ({ page }) => {
  await page.goto("/");
  await composeText(page, "The first saved passage plays.\n\nThe second saved passage follows.\n\nThe third saved passage finishes.");
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await prepareFromPlayer(page);
  await expect(page.getByText("Audio prepared — playback no longer waits on the server", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Pause/ }).click();

  await page.goto("/library");
  const chip = page.getByRole("group", { name: "Prepared audio" }).getByRole("button").first();
  await chip.click();
  await page.getByRole("dialog", { name: "Audio preparation" }).getByRole("button", { name: "Save audio…" }).click();
  const dialog = page.getByRole("dialog", { name: "Save audio" });
  await expect(dialog.getByRole("status").first()).toContainText("on this device");

  // A backup: every clip and what playback needs to use it again.
  await dialog.getByRole("button", { name: /^Make backup file · 3 passages$/ }).click();
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save file" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/· ReadAloud audio\.zip$/);
  const path = test.info().outputPath("backup.zip");
  await download.saveAs(path);
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const manifest = JSON.parse(strFromU8(files["readaloud.json"])) as { clips: { path: string; words?: unknown[] }[]; documents: { title: string }[] };
  expect(manifest.clips).toHaveLength(3);
  expect(manifest.documents).toHaveLength(1);
  for (const clip of manifest.clips) expect(files[clip.path]?.length).toBeGreaterThan(0);
  expect(Object.keys(files)).toContain("README.txt");

  // Once saved, the audio can leave the device.
  await dialog.getByRole("button", { name: /^Remove .+ from this device$/ }).click();
  await expect(dialog.getByText(/^Removed .+ from this device\. Load the file/)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(chip).toHaveAttribute("title", /not prepared/);

  // Loading the file back puts every passage where playback finds it.
  await page.goto("/settings");
  const storage = page.getByRole("region", { name: "Storage" });
  await storage.locator('input[type="file"]').setInputFiles(path);
  const load = page.getByRole("dialog", { name: "Load audio" });
  await expect(load.getByText("New to this device")).toBeVisible();
  await expect(load.getByText(/^3 passages · /)).toBeVisible();
  await load.getByRole("button", { name: "Load audio" }).click();
  await expect(page.getByText(/^Loaded 3 passages · /)).toBeVisible();

  await page.goto("/library");
  await expect(chip).not.toHaveAttribute("title", /not prepared/);
  await expect(chip.getByRole("img").or(chip.locator("[role=progressbar]")).first()).toBeVisible();

  // The same file again has nothing new.
  await page.goto("/settings");
  await storage.locator('input[type="file"]').setInputFiles(path);
  await expect(load.getByText("Everything in this file is already on this device.")).toBeVisible();
  await load.getByRole("button", { name: "Cancel" }).click();
});

test("a fully prepared reading saves as an audiobook", async ({ page }) => {
  await page.goto("/");
  await composeText(page, "An audiobook opens here.\n\nIt closes here.");
  await page.getByTestId("listen").click();
  await page.waitForURL(/\/read\/[a-z0-9-]+$/);
  await prepareFromPlayer(page);
  await expect(page.getByText("Audio prepared — playback no longer waits on the server", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Player" }).getByRole("button", { name: /^Pause/ }).click();

  await page.goto("/library");
  await page.getByRole("group", { name: "Prepared audio" }).getByRole("button").first().click();
  await page.getByRole("dialog", { name: "Audio preparation" }).getByRole("button", { name: "Save audio…" }).click();
  const dialog = page.getByRole("dialog", { name: "Save audio" });
  await dialog.getByRole("radio", { name: "Audiobook" }).click();
  await expect(dialog.getByRole("radiogroup", { name: "Audiobook voice" }).getByText("Complete")).toBeVisible();
  // Chromium on Linux has no AAC encoder, and the stub speaks WAV, which only an M4B can re-encode.
  if (await dialog.getByText(/can’t make M4B files/).isVisible()) {
    await dialog.getByRole("button", { name: "Make audiobook" }).click();
    await expect(page.getByText(/isn't MP3, so this browser can't join it\. Try Safari or the iPhone app\./)).toBeVisible();
    return;
  }
  await dialog.getByRole("button", { name: "Make audiobook" }).click();
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save audiobook" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.m4b$/);
  const path = test.info().outputPath("book.m4b");
  await download.saveAs(path);
  expect(readFileSync(path).subarray(4, 12).toString("latin1")).toBe("ftypM4B ");
});
