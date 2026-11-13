import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SlideStore, slideMiddleware } from "./vite.slides";

const DECK = "a".repeat(32);
const jpeg = (page: number) => Buffer.from([0xff, 0xd8, 0xff, page]);

describe("slide pictures", () => {
  let directory: string;
  /** Stands in for pdf.js: hands over a tiny picture per page, once `release` lets it. */
  let draw: ReturnType<typeof vi.fn>;
  let release: () => void;
  const files = () => readdir(join(directory, DECK)).then((names) => names.sort());

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "readaloud-slides-"));
    let held: Promise<void> = Promise.resolve();
    release = () => {};
    draw = vi.fn(async (_bytes: Uint8Array, pages: number[], each: (page: number, picture: Buffer) => Promise<void>) => {
      for (const page of pages) { await held; await each(page, jpeg(page)); }
    });
    (draw as unknown as { hold: () => void }).hold = () => { held = new Promise((resolve) => { release = resolve; }); };
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("names a deck by its file, and draws the pages that were given an address", async () => {
    const store = new SlideStore(directory, draw);
    const deck = store.for(Buffer.from("one deck"));
    expect(deck.url(3)).toMatch(/^\/api\/slides\/[a-f0-9]{32}\/3\.jpg$/);
    expect(store.for(Buffer.from("one deck")).url(3)).toBe(deck.url(3));
    expect(store.for(Buffer.from("another")).url(3)).not.toBe(deck.url(3));
    deck.url(7);
    await deck.keep();
    await store.idle();
    expect(draw.mock.calls[0][1]).toEqual([3, 7]);
    expect(await readdir(join(directory, deck.url(3).split("/")[3]))).toEqual(["3.jpg", "7.jpg"]);
  });

  it("keeps the deck only until its pictures are drawn, and does not draw them twice", async () => {
    const store = new SlideStore(directory, draw);
    await store.keep(DECK, Buffer.from("%PDF"), [2, 5]);
    await store.idle();
    expect(await files()).toEqual(["2.jpg", "5.jpg"]);
    await store.keep(DECK, Buffer.from("%PDF"), [2, 5]);
    await store.idle();
    expect(draw).toHaveBeenCalledTimes(1);
    // A page the deck did not have before is drawn on its own.
    await store.keep(DECK, Buffer.from("%PDF"), [2, 5, 6]);
    await store.idle();
    expect(draw.mock.calls[1][1]).toEqual([6]);
    expect(await files()).toEqual(["2.jpg", "5.jpg", "6.jpg"]);
  });

  it("makes a picture asked for early wait until it is drawn", async () => {
    (draw as unknown as { hold: () => void }).hold();
    const store = new SlideStore(directory, draw);
    await store.keep(DECK, Buffer.from("%PDF"), [1, 2]);
    let found: string | null | undefined;
    const asked = store.picture(DECK, 2).then((file) => { found = file; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(found).toBeUndefined();
    release();
    await asked;
    expect(found).toBe(join(directory, DECK, "2.jpg"));
    expect(await store.picture(DECK, 9)).toBeNull();
    expect(await store.picture("b".repeat(32), 1)).toBeNull();
  });

  it("picks up a deck that was left half drawn", async () => {
    await mkdir(join(directory, DECK));
    await writeFile(join(directory, DECK, "source.pdf"), "%PDF");
    await writeFile(join(directory, DECK, "pages.json"), "[1,2,3]");
    await writeFile(join(directory, DECK, "1.jpg"), jpeg(1));
    const store = new SlideStore(directory, draw);
    expect(await store.picture(DECK, 3)).toBe(join(directory, DECK, "3.jpg"));
    await store.idle();
    expect(draw.mock.calls[0][1]).toEqual([2, 3]);
    expect(await files()).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
  });

  it("gives up on a deck that cannot be drawn without stopping the next", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    draw.mockRejectedValueOnce(new Error("broken"));
    const store = new SlideStore(directory, draw);
    await store.keep(DECK, Buffer.from("%PDF"), [1]);
    await store.keep("c".repeat(32), Buffer.from("%PDF"), [1]);
    await store.idle();
    expect(await store.picture("c".repeat(32), 1)).toBe(join(directory, "c".repeat(32), "1.jpg"));
    expect(error).toHaveBeenCalled();
    // The broken deck is not kept to be tried again each time one of its pictures is asked for.
    expect(await files()).toEqual([]);
    expect(await store.picture(DECK, 1)).toBeNull();
    expect(draw).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  describe("served", () => {
    let server: Server, url: string;
    beforeEach(async () => {
      const store = new SlideStore(directory, draw);
      await store.keep(DECK, Buffer.from("%PDF"), [4]);
      const handler = slideMiddleware(store);
      server = createServer((req, res) => { req.url = req.url?.replace("/api/slides", ""); handler(req, res, () => { res.statusCode = 418; res.end(); }); });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/slides`;
    });
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("as a JPEG that never changes", async () => {
      const response = await fetch(`${url}/${DECK}/4.jpg`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("cache-control")).toContain("immutable");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg(4));
    });

    it("only for pictures it has, at addresses of the right shape", async () => {
      expect((await fetch(`${url}/${DECK}/5.jpg`)).status).toBe(404);
      expect((await fetch(`${url}/${"d".repeat(32)}/4.jpg`)).status).toBe(404);
      // Anything else is not this route's to answer.
      for (const path of [`/${DECK}/source.pdf`, `/${DECK}/pages.json`, "/..%2f..%2fetc%2fpasswd/1.jpg", `/${DECK.toUpperCase()}/4.jpg`]) expect((await fetch(url + path)).status).toBe(418);
      expect((await fetch(`${url}/${DECK}/4.jpg`, { method: "POST" })).status).toBe(418);
    });
  });
});
