import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writePrivate } from "./vite.files";

describe("writePrivate", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "readaloud-files-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("makes the folder and file readable only by this user, and replaces what was there", async () => {
    const file = join(directory, "deck", "pages.json");
    await writePrivate(file, "[1]");
    await writePrivate(file, "[1,2]");
    expect(await readFile(file, "utf8")).toBe("[1,2]");
    expect((await stat(join(directory, "deck"))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, "deck"))).toEqual(["pages.json"]);
  });

  it("leaves nothing behind when the write cannot land", async () => {
    await mkdir(join(directory, "taken"));
    await expect(writePrivate(join(directory, "taken"), "x")).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["taken"]);
  });

  it("lands every one of several writes to the same file at once", async () => {
    const file = join(directory, "job.json");
    await Promise.all(["a", "b", "c"].map((text) => writePrivate(file, text)));
    expect(["a", "b", "c"]).toContain(await readFile(file, "utf8"));
    expect(await readdir(directory)).toEqual(["job.json"]);
  });
});
