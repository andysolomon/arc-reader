import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import { drawPages, type SlidePictures } from "./vite.pdf";

/**
 * Pictures of slides, drawn from the decks that were imported. GET /api/slides/<deck>/<page>.jpg
 * serves one. A deck is named by a fingerprint of its file, so importing it again reuses what
 * is there. The file itself is kept only until its pictures are drawn, which happens in the
 * background, one deck at a time; a picture asked for before then waits its turn.
 */

export const SLIDE_ROUTE = "/api/slides";
const PICTURE = /^\/([a-f0-9]{32})\/(\d{1,4})\.jpg$/;

const exists = (file: string) => access(file).then(() => true, () => false);

interface Job {
  done: Promise<void>;
  /** Called as each page is finished */
  drawn: Set<(page: number) => void>;
}

export class SlideStore implements SlidePictures {
  private jobs = new Map<string, Job>();
  private turn: Promise<void> = Promise.resolve();

  constructor(private directory: string, private draw: typeof drawPages = drawPages) {}

  private file = (deck: string, name: string | number) => resolve(this.directory, deck, typeof name === "number" ? `${name}.jpg` : name);

  for(bytes: Uint8Array) {
    const deck = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const pages = new Set<number>();
    return {
      url: (page: number) => { pages.add(page); return `${SLIDE_ROUTE}/${deck}/${page}.jpg`; },
      keep: () => this.keep(deck, bytes, [...pages]),
    };
  }

  /** Save the deck and start drawing the pages that are wanted and not already drawn. */
  async keep(deck: string, bytes: Uint8Array, pages: number[]): Promise<void> {
    if (!pages.length || this.jobs.has(deck)) return;
    const missing = await this.missing(deck, pages);
    if (!missing.length) return;
    await mkdir(resolve(this.directory, deck), { recursive: true, mode: 0o700 });
    for (const [name, data] of [["source.pdf", bytes], ["pages.json", JSON.stringify(pages)]] as const) {
      const temporary = this.file(deck, `${name}.${randomUUID()}.tmp`);
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, this.file(deck, name));
    }
    this.start(deck);
  }

  private async missing(deck: string, pages: number[]): Promise<number[]> {
    const drawn = await Promise.all(pages.map((page) => exists(this.file(deck, page))));
    return pages.filter((_, i) => !drawn[i]);
  }

  private start(deck: string): Job {
    const running = this.jobs.get(deck);
    if (running) return running;
    const job: Job = { done: Promise.resolve(), drawn: new Set() };
    const work = async () => {
      try {
        const pages = JSON.parse(await readFile(this.file(deck, "pages.json"), "utf8")) as number[];
        const missing = await this.missing(deck, pages);
        if (missing.length) {
          await this.draw(await readFile(this.file(deck, "source.pdf")), missing, async (page, jpeg) => {
            const temporary = this.file(deck, `${page}.${randomUUID()}.tmp`);
            await writeFile(temporary, jpeg, { mode: 0o600 });
            await rename(temporary, this.file(deck, page));
            for (const tell of job.drawn) tell(page);
          });
        }
      } finally {
        // What could be drawn has been, and a deck that cannot be is not tried again on every
        // request: either way the deck itself is no longer needed.
        await rm(this.file(deck, "source.pdf"), { force: true });
        await rm(this.file(deck, "pages.json"), { force: true });
      }
    };
    job.done = (this.turn = this.turn.then(work).catch((error) => { console.error("Drawing slides failed:", error); }))
      .finally(() => { this.jobs.delete(deck); });
    this.jobs.set(deck, job);
    return job;
  }

  /** The picture's file, once it is drawn; null when the deck never had that picture. */
  async picture(deck: string, page: number): Promise<string | null> {
    const file = this.file(deck, page);
    if (await exists(file)) return file;
    // A deck left half drawn, by a restart say, is picked up where it stopped.
    if (!this.jobs.has(deck) && !(await exists(this.file(deck, "source.pdf")) && await exists(this.file(deck, "pages.json")))) return null;
    const job = this.start(deck);
    await new Promise<void>((done) => {
      const tell = (drawn: number) => { if (drawn === page) done(); };
      job.drawn.add(tell);
      void job.done.finally(() => { job.drawn.delete(tell); done(); });
    });
    return await exists(file) ? file : null;
  }

  /** Resolves once nothing is being drawn. */
  idle = () => this.turn;
}

export function slideMiddleware(store: SlideStore): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next) => {
    const match = (req.url ?? "").split("?")[0].match(PICTURE);
    if (!match || (req.method !== "GET" && req.method !== "HEAD")) return next();
    void store.picture(match[1], Number(match[2])).then((file) => {
      if (!file) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        return void res.end(JSON.stringify({ error: "no_picture" }));
      }
      // A picture is named for the file it was drawn from, so it never changes.
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" });
      if (req.method === "HEAD") return void res.end();
      createReadStream(file).on("error", () => res.destroy()).pipe(res);
    }).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "cache-control": "no-store" });
      res.end();
    });
  };
}
