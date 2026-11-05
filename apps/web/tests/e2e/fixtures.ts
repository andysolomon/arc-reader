import { test as base } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryService } from "../../vite.library";

export { expect, type Page } from "@playwright/test";

// UI tests get separate libraries. shared-library.spec.ts uses the real HTTP API instead.
export const test = base.extend<{ isolatedLibrary: void }>({
  isolatedLibrary: [async ({ context }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "readaloud-ui-library-"));
    const library = new LibraryService(directory);
    await context.route("**/api/library/sync", async (route) => {
      await route.fulfill({ json: await library.sync(route.request().postDataJSON()) });
    });
    await use();
    await context.unrouteAll({ behavior: "wait" });
    await rm(directory, { recursive: true, force: true });
  }, { auto: true }],
});
