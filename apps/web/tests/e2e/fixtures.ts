import { test as base } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryService } from "../../vite.library";
import { BookImports, bookFrom, readOnServer } from "../../vite.books";

export { expect, type Page } from "@playwright/test";

// UI tests get separate libraries. shared-library.spec.ts uses the real HTTP API instead.
export const test = base.extend<{ isolatedLibrary: void }>({
  isolatedLibrary: [async ({ context }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "readaloud-ui-library-"));
    const library = new LibraryService(directory);
    await context.route("**/api/preparations", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { jobs: [] } });
      await route.fallback();
    });
    await context.route(/\/api\/library\/(sync|docs)$/, async (route) => {
      await route.fulfill({ json: await library.request(new URL(route.request().url()).pathname.replace("/api/library", ""), route.request().postDataJSON()) });
    });
    // Books are added into the same separate library, by the server's own import code.
    const imports = new BookImports(library, readOnServer());
    await context.route("**/api/books/import", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { jobs: imports.list() } });
      await route.fulfill({ json: { job: imports.start(bookFrom(route.request().postDataJSON())).job } });
    });
    await use();
    await context.unrouteAll({ behavior: "wait" });
    await rm(directory, { recursive: true, force: true });
  }, { auto: true }],
});
