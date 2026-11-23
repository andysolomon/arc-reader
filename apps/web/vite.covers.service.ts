import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Option, Queue, Schedule, Schema, Semaphore } from "effect";
import type { DocRecord } from "./src/lib/db";
import { ARTICLE_COVER, COVER_STYLE, coverPlan, type CoverSection } from "./src/lib/covers";
import type { CoverLibrary, DocCovers } from "./src/lib/coverProtocol";
import { coverPrompt, directionMessages, excerpt, type ArtDirection, type DirectionRequest } from "./vite.covers.prompt";

/**
 * Covers for the library: one for every article and one for every section under a heading.
 *
 * The art is asked for one piece at a time by a worker that outlives requests. Each piece is
 * kept under a fingerprint of the text it was drawn from, so an article that is imported again,
 * or edited in one place, reuses everything that did not change.
 */

export class CoverStorageError extends Schema.TaggedError<CoverStorageError>()("CoverStorageError", {
  cause: Schema.Defect(),
}) {}

/** The image service said no, or could not be heard. `message` is safe to show: it never carries a response body. */
export class ImageError extends Schema.TaggedError<ImageError>()("ImageError", {
  message: Schema.String,
  /** Refused before any work was done (rate limit, server error), so asking again is not billed twice */
  retryable: Schema.Boolean,
}) {}

export class CoversUnavailable extends Schema.TaggedError<CoversUnavailable>()("CoversUnavailable", {
  message: Schema.String,
}) {}

export class DocumentMissing extends Schema.TaggedError<DocumentMissing>()("DocumentMissing", {
  docId: Schema.String,
}) {}

// ---------------------------------------------------------------------------------------------
// Settings

export interface CoverConfig {
  /** Where manifests, art and the day's count are kept */
  directory: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  size: string;
  quality: string;
  /** How the art is kept: WebP is about a tenth the size of PNG for the same ink drawing */
  format: "webp" | "png";
  /** New pieces of art in any 24 hours; what is queued beyond it waits */
  dailyLimit: number;
  /** Pieces drawn at once */
  workers: number;
  /** The text model that decides what each cover shows */
  directionModel: string;
  /** First wait before asking again after a rate limit or server error */
  retryDelayMs: number;
}

const whole = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= min ? Math.min(n, max) : fallback;
};

export function coverConfig(env: Record<string, string | undefined>, directory: string): CoverConfig {
  return {
    directory,
    enabled: !/^(?:off|0|false|no)$/i.test(env.COVERS ?? ""),
    apiKey: env.OPENAI_API_KEY ?? "",
    baseUrl: (env.OPENAI_URL || "https://api.openai.com").replace(/\/$/, "").replace(/\/v1$/, ""),
    model: env.COVER_IMAGE_MODEL || "gpt-image-2",
    size: env.COVER_IMAGE_SIZE || "1024x1024",
    quality: env.COVER_IMAGE_QUALITY || "low",
    format: env.COVER_IMAGE_FORMAT === "png" ? "png" : "webp",
    dailyLimit: whole(env.COVER_DAILY_LIMIT, 200, 0, 100_000),
    workers: whole(env.COVER_WORKERS, 1, 1, 4),
    directionModel: env.COVER_DIRECTION_MODEL || "muse-spark-1.3-contributor",
    retryDelayMs: 2000,
  };
}

export class CoverSettings extends Context.Service<CoverSettings, CoverConfig>()("readaloud/covers/CoverSettings") {}

// ---------------------------------------------------------------------------------------------
// What is kept on disk

const Status = Schema.Literals(["queued", "generating", "ready", "failed", "blocked"]);
const Direction = Schema.Struct({ subject: Schema.String, accent: Schema.String, alt: Schema.String });

const Entry = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literals(["article", "section"]),
  heading: Schema.String,
  level: Schema.Number,
  path: Schema.Array(Schema.String),
  ordinal: Schema.Number,
  parent: Schema.String,
  /** Fingerprint of what the art is drawn from: the section's text, the style and the image settings */
  asset: Schema.String,
  status: Status,
  /** File name of the art, once ready */
  image: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  updated: Schema.Number,
  direction: Schema.optional(Direction),
});
type Entry = typeof Entry.Type;

const Manifest = Schema.Struct({
  docId: Schema.String,
  title: Schema.String,
  style: Schema.String,
  headings: Schema.Number,
  /** When covers were last asked for; the newest article's sections are drawn first */
  requested: Schema.Number,
  covers: Schema.Array(Entry),
});
export type Manifest = typeof Manifest.Type;

/** Everything needed to audit or redo one piece of art: what was asked for, of which model. */
const Sheet = Schema.Struct({
  asset: Schema.String,
  image: Schema.String,
  prompt: Schema.String,
  model: Schema.String,
  size: Schema.String,
  quality: Schema.String,
  style: Schema.String,
  direction: Schema.optional(Direction),
  createdAt: Schema.Number,
});
export type Sheet = typeof Sheet.Type;

const Usage = Schema.Struct({ drawn: Schema.Array(Schema.Number) });

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const HEX = /^[a-f0-9]{64}$/;
const IMAGE_NAME = /^[a-f0-9]{64}-[a-f0-9-]{36}\.(?:png|webp)$/;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The bytes are the kind of picture that was asked for, whatever the answer called them. */
const pictured = (bytes: Buffer, format: "webp" | "png") => format === "png"
  ? bytes.subarray(0, 8).equals(PNG)
  : bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";

export class CoverFiles extends Context.Service<CoverFiles, {
  readonly manifests: Effect.Effect<ReadonlyArray<Manifest>, CoverStorageError>;
  saveManifest(manifest: Manifest): Effect.Effect<void, CoverStorageError>;
  removeManifest(docId: string): Effect.Effect<void, CoverStorageError>;
  sheet(asset: string): Effect.Effect<Option.Option<Sheet>, CoverStorageError>;
  /** Saves the art, then the sheet that points to it: a sheet never names a missing picture. */
  saveArt(sheet: Omit<Sheet, "image">, bytes: Uint8Array, format: "webp" | "png"): Effect.Effect<Sheet, CoverStorageError>;
  image(name: string): Effect.Effect<Option.Option<Buffer>>;
  readonly usage: Effect.Effect<ReadonlyArray<number>, CoverStorageError>;
  saveUsage(drawn: ReadonlyArray<number>): Effect.Effect<void, CoverStorageError>;
}>()("readaloud/covers/CoverFiles") {
  static readonly layer = Layer.effect(
    CoverFiles,
    Effect.gen(function*() {
      const { directory } = yield* CoverSettings;
      const folder = { docs: join(directory, "docs"), assets: join(directory, "assets"), images: join(directory, "images") };
      const attempt = <A>(task: () => Promise<A>) => Effect.tryPromise({ try: task, catch: (cause) => new CoverStorageError({ cause }) });
      const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
      /** A reader never sees half a file: write beside it, then rename over it. */
      const atomic = async (file: string, data: string | Uint8Array) => {
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, data, { mode: 0o600 });
        await rename(temporary, file);
      };
      const json = async <S extends Schema.Top>(file: string, schema: S): Promise<Option.Option<S["Type"]>> => {
        let text: string;
        try { text = await readFile(file, "utf8"); }
        catch (error) { if (missing(error)) return Option.none(); throw error; }
        // A file that no longer reads as what it was is left alone and treated as absent.
        try { return Schema.decodeUnknownOption(schema as never)(JSON.parse(text)) as Option.Option<S["Type"]>; }
        catch { return Option.none(); }
      };

      yield* attempt(async () => { for (const path of Object.values(folder)) await mkdir(path, { recursive: true, mode: 0o700 }); });

      return CoverFiles.of({
        manifests: attempt(async () => {
          const found: Manifest[] = [];
          for (const name of await readdir(folder.docs)) {
            if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
            const manifest = await json(join(folder.docs, name), Manifest);
            if (Option.isSome(manifest) && sha256(manifest.value.docId) === name.slice(0, -5)) found.push(manifest.value);
          }
          return found;
        }),
        saveManifest: (manifest) => attempt(() => atomic(join(folder.docs, `${sha256(manifest.docId)}.json`), JSON.stringify(manifest))),
        removeManifest: (docId) => attempt(() => rm(join(folder.docs, `${sha256(docId)}.json`), { force: true })),
        sheet: (asset) => HEX.test(asset) ? attempt(() => json(join(folder.assets, `${asset}.json`), Sheet)) : Effect.succeed(Option.none()),
        saveArt: (sheet, bytes, format) => attempt(async () => {
          const saved: Sheet = { ...sheet, image: `${sheet.asset}-${randomUUID()}.${format}` };
          await atomic(join(folder.images, saved.image), bytes);
          await atomic(join(folder.assets, `${sheet.asset}.json`), JSON.stringify(saved));
          return saved;
        }),
        image: (name) => IMAGE_NAME.test(name)
          ? Effect.promise(() => readFile(join(folder.images, name)).then((bytes) => Option.some(bytes), () => Option.none<Buffer>()))
          : Effect.succeed(Option.none()),
        usage: attempt(async () => Option.match(await json(join(directory, "usage.json"), Usage), { onNone: () => [], onSome: (usage) => usage.drawn })),
        saveUsage: (drawn) => attempt(() => atomic(join(directory, "usage.json"), JSON.stringify({ drawn }))),
      });
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// The image model

const ImageAnswer = Schema.Struct({ data: Schema.Array(Schema.Struct({ b64_json: Schema.String })) });

export class ImageModel extends Context.Service<ImageModel, {
  /** One picture for the prompt, in the format the settings name. Never retried here: the caller decides what is safe to ask twice. */
  generate(prompt: string): Effect.Effect<Uint8Array, ImageError>;
}>()("readaloud/covers/ImageModel") {
  /** OpenAI's image endpoint, with the key this server already holds. Nothing it answers is passed on. */
  static readonly layerOpenAi = (fetchImpl: typeof fetch = fetch) => Layer.effect(
    ImageModel,
    Effect.gen(function*() {
      const settings = yield* CoverSettings;
      const refused = (message: string, retryable = false) => new ImageError({ message, retryable });
      const generate = Effect.fn("ImageModel.generate")(function*(prompt: string) {
        const response = yield* Effect.tryPromise({
          try: (signal) => fetchImpl(`${settings.baseUrl}/v1/images/generations`, {
            method: "POST",
            headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model: settings.model, n: 1, size: settings.size, quality: settings.quality, prompt,
              output_format: settings.format, ...(settings.format === "webp" ? { output_compression: 82 } : {}),
            }),
            signal,
          }),
          // The request may have been taken and billed before the line dropped: ask again only when told to.
          catch: () => refused("OpenAI could not be reached. Retry the cover."),
        });
        if (!response.ok) {
          return yield* response.status === 403 ? refused("OpenAI denied image access. Check image-model access for the API key, then retry.")
            : response.status === 429 ? refused("OpenAI image quota or rate limit reached. Retry later.", true)
            : response.status === 400 ? refused("OpenAI declined to draw this cover.")
            : refused(`OpenAI image request failed (${response.status}). Retry the cover.`, response.status >= 500);
        }
        const answer = yield* Effect.tryPromise({ try: () => response.json() as Promise<unknown>, catch: () => refused("OpenAI returned no usable cover. Retry the cover.") })
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(ImageAnswer)), Effect.mapError(() => refused("OpenAI returned no usable cover. Retry the cover.")));
        const encoded = answer.data[0]?.b64_json;
        if (!encoded || encoded.length > 28_000_000) return yield* refused("OpenAI returned no usable cover. Retry the cover.");
        const bytes = Buffer.from(encoded, "base64");
        if (!pictured(bytes, settings.format)) return yield* refused("OpenAI returned an invalid image. Retry the cover.");
        return new Uint8Array(bytes);
      }, Effect.timeoutOrElse({ duration: "180 seconds", orElse: () => Effect.fail(refused("OpenAI took too long to draw this cover. Retry the cover.")) }));
      return ImageModel.of({ generate });
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// The art director

const DirectorAnswer = Schema.Struct({
  covers: Schema.Array(Schema.Struct({ key: Schema.String, subject: Schema.String, accent: Schema.String, alt: Schema.String })),
});
const ChatAnswer = Schema.Struct({
  choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.String }) })),
});

/** One line of a model's words, fit to go into a prompt or an alt attribute. */
const line = (text: string, max: number) => text.replace(/https?:\/\/\S+/gi, "").replace(/[`<>{}]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
/** Covers settled in one request: enough to keep each section's object different from its neighbours'. */
const DIRECTION_BATCH = 16;

export class ArtDirector extends Context.Service<ArtDirector, {
  /**
   * What to draw for each cover. A cover it gives no answer for is drawn from its text alone,
   * so this never fails: no key, no answer and nonsense all come back as fewer directions.
   */
  direct(session: string, title: string, covers: ReadonlyArray<DirectionRequest>): Effect.Effect<ReadonlyMap<string, ArtDirection>>;
}>()("readaloud/covers/ArtDirector") {
  /** No director: every cover is drawn straight from its text. */
  static readonly layerNone = Layer.succeed(ArtDirector, ArtDirector.of({ direct: () => Effect.succeed(new Map()) }));

  /** A chat model behind an OpenAI-compatible endpoint: the one the summaries use. */
  static readonly layerChat = (keys: { key(): Promise<{ key: string }> }, upstream: string, fetchImpl: typeof fetch = fetch) => Layer.effect(
    ArtDirector,
    Effect.gen(function*() {
      const settings = yield* CoverSettings;
      const base = upstream.replace(/\/$/, "");
      const ask = Effect.fn("ArtDirector.ask")(function*(key: string, session: string, title: string, batch: ReadonlyArray<DirectionRequest>, taken: string[]) {
        const response = yield* Effect.tryPromise((signal) => fetchImpl(`${base}/v1/chat/completions`, {
          method: "POST",
          // OpenCode Go routes by a session that stays the same for one piece of work: here, one article.
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "readaloud/0.1", "x-opencode-session": session },
          body: JSON.stringify({ model: settings.directionModel, max_tokens: 16_000, messages: directionMessages(title, [...batch], taken) }),
          signal,
        }));
        if (!response.ok) return yield* Effect.fail(new Error(`HTTP ${response.status}`));
        const chat = yield* Effect.tryPromise(() => response.json() as Promise<unknown>).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ChatAnswer)));
        const content = (chat.choices[0]?.message.content ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        const answer = yield* Effect.try(() => JSON.parse(content) as unknown).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DirectorAnswer)));
        return answer.covers;
      }, Effect.timeout("120 seconds"));

      const direct = Effect.fn("ArtDirector.direct")(function*(session: string, title: string, covers: ReadonlyArray<DirectionRequest>) {
        const directions = new Map<string, ArtDirection>();
        const { key } = yield* Effect.tryPromise(() => keys.key());
        if (!key) return directions;
        const wanted = new Set(covers.map((cover) => cover.key));
        for (let start = 0; start < covers.length; start += DIRECTION_BATCH) {
          const answers = yield* ask(key, session, title, covers.slice(start, start + DIRECTION_BATCH), [...directions.values()].map((d) => d.subject));
          for (const answer of answers) {
            const direction = { subject: line(answer.subject, 400), accent: line(answer.accent, 160), alt: line(answer.alt, 300) };
            if (wanted.has(answer.key) && direction.subject && direction.alt) directions.set(answer.key, direction);
          }
        }
        return directions;
      });

      return ArtDirector.of({
        direct: (session, title, covers) => {
          const directions = new Map<string, ArtDirection>();
          // Whatever was settled before a failure is kept; the rest are drawn from their text.
          return direct(session, title, covers).pipe(
            Effect.tap((found) => Effect.sync(() => { for (const [key, direction] of found) directions.set(key, direction); })),
            Effect.catchCause(() => Effect.logWarning("Cover art direction was unavailable; drawing from the text alone.")),
            Effect.as(directions),
          );
        },
      });
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// The library the covers are of

export class Documents extends Context.Service<Documents, {
  get(docId: string): Effect.Effect<Option.Option<DocRecord>, CoverStorageError>;
}>()("readaloud/covers/Documents") {
  static readonly layerLibrary = (library: { documents(): Promise<DocRecord[]> }) => Layer.succeed(Documents, Documents.of({
    get: (docId) => Effect.tryPromise({ try: () => library.documents(), catch: (cause) => new CoverStorageError({ cause }) })
      .pipe(Effect.map((docs) => Option.fromNullishOr(docs.find((doc) => doc.id === docId)))),
  }));
}

// ---------------------------------------------------------------------------------------------
// The covers themselves

const DAY = 24 * 60 * 60 * 1000;
const INTERRUPTED = "Cover creation was interrupted. Retry the cover.";
const UNFINISHED = "Cover creation could not finish. Retry the cover.";
const waiting = (entry: Entry) => entry.status === "queued" || entry.status === "generating";
const urlOf = (entry: Entry) => entry.status === "ready" && entry.image ? `/api/covers/images/${entry.image}` : undefined;
const altOf = (entry: Entry) => entry.direction?.alt
  || (entry.kind === "article" ? `Cover illustration for “${entry.heading}”` : `Illustration for the section “${entry.heading}”`);

function wire(manifest: Manifest): DocCovers {
  return {
    docId: manifest.docId, style: manifest.style, headings: manifest.headings,
    covers: manifest.covers.map((entry) => {
      const url = urlOf(entry);
      return {
        key: entry.key, kind: entry.kind, heading: entry.heading, path: [...entry.path], level: entry.level, ordinal: entry.ordinal, parent: entry.parent,
        status: entry.status, ...(url ? { url } : {}), alt: altOf(entry), ...(entry.error ? { error: entry.error } : {}), updated: entry.updated,
      };
    }),
  };
}

interface Job { docId: string; key: string; asset: string }

export class Covers extends Context.Service<Covers, {
  /** Every document's article cover, for the Library. */
  readonly library: Effect.Effect<CoverLibrary>;
  /** A document's covers as they stand. */
  document(docId: string): Effect.Effect<DocCovers, DocumentMissing>;
  /**
   * Makes sure a document has a cover for the article and for each section, queueing what is
   * missing. Sections whose text is unchanged keep their art. Failed ones are queued again only
   * when `retry` is set, since a failed request may already have been paid for.
   */
  ensure(docId: string, retry?: boolean): Effect.Effect<DocCovers, DocumentMissing | CoversUnavailable | CoverStorageError>;
  /** A document was added to the library: it gets its covers without anyone asking. */
  added(doc: DocRecord): Effect.Effect<void, CoverStorageError>;
  /** A document's text changed: covers it already has are checked against it, section by section. */
  changed(doc: DocRecord): Effect.Effect<void, CoverStorageError>;
  /** A document was deleted. Its art stays, to be reused if the same text comes back. */
  forget(docId: string): Effect.Effect<void, CoverStorageError>;
  image(name: string): Effect.Effect<Option.Option<Buffer>>;
}>()("readaloud/covers/Covers") {
  static readonly layer = Layer.effect(
    Covers,
    Effect.gen(function*() {
      const settings = yield* CoverSettings;
      const files = yield* CoverFiles;
      const images = yield* ImageModel;
      const director = yield* ArtDirector;
      const documents = yield* Documents;
      const configured = settings.enabled && !!settings.apiKey;

      /** One writer at a time: phones, the library and the workers all change the same manifests. */
      const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));
      /** Something may be waiting to be drawn. One token is enough: a worker looks at everything. */
      const wake = yield* Queue.sliding<void>(1);
      const manifests = new Map<string, Manifest>();
      /** Art being drawn now, so two documents with the same text do not pay for it twice. */
      const drawing = new Set<string>();
      /** Art the director has been asked about. It is asked once: a cover it passed over is drawn from its text. */
      const asked = new Set<string>();
      let drawn = [...(yield* files.usage)];
      let paused = false;

      const assetOf = (section: CoverSection) => sha256(JSON.stringify([COVER_STYLE, settings.model, settings.size, settings.quality, section.kind, section.path, section.body]));

      const store = Effect.fnUntraced(function*(manifest: Manifest) {
        yield* files.saveManifest(manifest);
        manifests.set(manifest.docId, manifest);
      });
      /** Changes the entries that match, in every document, and saves the documents that changed. */
      const amend = Effect.fnUntraced(function*(matches: (entry: Entry, manifest: Manifest) => boolean, change: (entry: Entry) => Entry) {
        const now = yield* Clock.currentTimeMillis;
        for (const manifest of [...manifests.values()]) {
          if (!manifest.covers.some((entry) => matches(entry, manifest))) continue;
          yield* store({ ...manifest, covers: manifest.covers.map((entry) => matches(entry, manifest) ? { ...change(entry), updated: now } : entry) });
        }
      });
      const failed = (job: Job, message: string) => exclusive(amend(
        (entry, manifest) => manifest.docId === job.docId && entry.key === job.key && entry.asset === job.asset && entry.status === "generating",
        ({ image: _image, ...entry }) => ({ ...entry, status: "failed" as const, error: message }),
      ));
      /** The art exists: every cover waiting on it, in any document, is ready. */
      const settle = (sheet: Sheet) => amend(
        (entry) => entry.asset === sheet.asset && waiting(entry),
        ({ error: _error, ...entry }) => ({ ...entry, status: "ready" as const, image: sheet.image, ...(sheet.direction ? { direction: sheet.direction } : {}) }),
      );

      // A request cut off by a restart may already have been billed, so it waits for someone to ask again.
      for (const manifest of yield* files.manifests) {
        manifests.set(manifest.docId, manifest);
        if (manifest.covers.some((entry) => entry.status === "generating")) {
          yield* store({ ...manifest, covers: manifest.covers.map((entry) => entry.status === "generating" ? { ...entry, status: "failed" as const, error: INTERRUPTED } : entry) });
        }
      }

      /** Brings a document's covers into line with its text. Call with the lock held. */
      const reconcile = Effect.fnUntraced(function*(doc: DocRecord, retry: boolean) {
        const plan = coverPlan(doc);
        const previous = manifests.get(doc.id);
        const now = yield* Clock.currentTimeMillis;
        const covers: Entry[] = [];
        for (const section of plan.sections) {
          const asset = assetOf(section);
          const place = { key: section.key, kind: section.kind, heading: section.heading, level: section.level, path: section.path, ordinal: section.ordinal, parent: section.parent, asset };
          const before = previous?.covers.find((entry) => entry.key === section.key && entry.asset === asset);
          // Nothing under the heading: say so, and draw nothing made up from the heading alone.
          if (!section.body.trim()) { covers.push({ ...place, status: "blocked", updated: before?.updated ?? now }); continue; }
          if (before && before.status !== "blocked" && !(retry && before.status === "failed")) { covers.push({ ...before, ...place }); continue; }
          // Asked for again by hand: the director gets another say too.
          asked.delete(asset);
          const sheet = yield* files.sheet(asset);
          covers.push(Option.isSome(sheet)
            ? { ...place, status: "ready", image: sheet.value.image, updated: now, ...(sheet.value.direction ? { direction: sheet.value.direction } : {}) }
            : { ...place, status: "queued", updated: now, ...(before?.direction ? { direction: before.direction } : {}) });
        }
        const manifest: Manifest = { docId: doc.id, title: plan.sections[0].heading, style: COVER_STYLE, headings: plan.headings, requested: now, covers };
        const same = previous && JSON.stringify({ ...previous, requested: 0 }) === JSON.stringify({ ...manifest, requested: 0 });
        // Asking again moves the document to the front without rewriting a file that says the same.
        if (same) manifests.set(doc.id, manifest); else yield* store(manifest);
        if (covers.some((entry) => entry.status === "queued")) yield* Queue.offer(wake, undefined);
        return manifest;
      });

      /** How long until the day's limit lets another piece be drawn; 0 when it does now. */
      const allowance = Effect.fnUntraced(function*() {
        const now = yield* Clock.currentTimeMillis;
        drawn = drawn.filter((at) => at > now - DAY);
        return drawn.length < settings.dailyLimit ? 0 : Math.max(1, drawn[0] + DAY - now);
      });

      /** The next piece to draw: article covers before sections, the document asked for last before the others. */
      const next = exclusive(Effect.gen(function*() {
        let best: { manifest: Manifest; entry: Entry; index: number } | undefined;
        let others = 0;
        /** Lower is drawn sooner. */
        const before = (a: NonNullable<typeof best>, b: NonNullable<typeof best>) =>
          (a.entry.kind === "article" ? 0 : 1) - (b.entry.kind === "article" ? 0 : 1)
          || b.manifest.requested - a.manifest.requested
          || a.manifest.docId.localeCompare(b.manifest.docId)
          || a.index - b.index;
        for (const manifest of manifests.values()) {
          manifest.covers.forEach((entry, index) => {
            if (entry.status !== "queued" || drawing.has(entry.asset)) return;
            others++;
            const candidate = { manifest, entry, index };
            if (!best || before(candidate, best) < 0) best = candidate;
          });
        }
        if (!best) { paused = false; return { wait: Option.none<number>(), job: Option.none<Job>() }; }
        const wait = yield* allowance();
        paused = wait > 0;
        if (wait > 0) return { wait: Option.some(wait), job: Option.none<Job>() };
        const job: Job = { docId: best.manifest.docId, key: best.entry.key, asset: best.entry.asset };
        drawing.add(job.asset);
        yield* amend((entry, manifest) => manifest.docId === job.docId && entry.key === job.key && entry.status === "queued", (entry) => ({ ...entry, status: "generating" as const }));
        // More is waiting: let another worker, if there is one, start on it.
        if (others > 1) yield* Queue.offer(wake, undefined);
        return { wait: Option.none<number>(), job: Option.some(job) };
      }));

      const draw = Effect.fn("Covers.draw")(function*(job: Job) {
        const found = yield* documents.get(job.docId);
        if (Option.isNone(found)) return yield* exclusive(files.removeManifest(job.docId).pipe(Effect.tap(() => Effect.sync(() => manifests.delete(job.docId)))));
        const doc = found.value;
        const plan = coverPlan(doc);
        const section = plan.sections.find((candidate) => candidate.key === job.key);
        // The text moved on while this waited: check the document again instead of drawing what it no longer says.
        if (!section || assetOf(section) !== job.asset) return yield* exclusive(reconcile(doc, false)).pipe(Effect.asVoid);
        const kept = yield* files.sheet(job.asset);
        if (Option.isSome(kept)) return yield* exclusive(settle(kept.value));

        const title = plan.sections[0].heading;
        const entryNow = () => manifests.get(job.docId)?.covers.find((entry) => entry.key === job.key);
        if (!entryNow()?.direction && !asked.has(job.asset)) {
          // One request settles every cover of the article still to be drawn, so each gets a different object.
          const undirected = (manifests.get(job.docId)?.covers ?? []).filter((entry) => waiting(entry) && !entry.direction && !asked.has(entry.asset));
          for (const entry of undirected) asked.add(entry.asset);
          const requests = undirected.flatMap((entry): DirectionRequest[] => {
            const of = plan.sections.find((candidate) => candidate.key === entry.key);
            return of ? [{ key: of.key, kind: of.kind, path: of.path, text: excerpt(of.body, of.kind === "article" ? 2400 : 900) }] : [];
          });
          const directions = yield* director.direct(`readaloud-covers-${sha256(job.docId).slice(0, 16)}`, title, requests);
          if (directions.size) {
            yield* exclusive(amend(
              (entry, manifest) => manifest.docId === job.docId && waiting(entry) && !entry.direction && directions.has(entry.key),
              (entry) => ({ ...entry, direction: directions.get(entry.key)! }),
            ));
          }
        }
        const direction = entryNow()?.direction;
        const prompt = coverPrompt(title, section, direction, plan.sections.find((candidate) => candidate.key === section.parent && candidate.key !== ARTICLE_COVER));
        // Counted when asked, not when answered: a request that fails late may still have been billed.
        yield* exclusive(Effect.gen(function*() {
          drawn.push(yield* Clock.currentTimeMillis);
          yield* files.saveUsage(drawn);
        }));
        const bytes = yield* images.generate(prompt).pipe(Effect.retry(($) => $(Schedule.exponential(settings.retryDelayMs)).pipe(
          Schedule.upTo({ times: 2 }),
          Schedule.while(({ input }) => input.retryable),
        )));
        const sheet = yield* files.saveArt({
          asset: job.asset, prompt, model: settings.model, size: settings.size, quality: settings.quality, style: COVER_STYLE,
          ...(direction ? { direction } : {}), createdAt: yield* Clock.currentTimeMillis,
        }, bytes, settings.format);
        yield* exclusive(settle(sheet));
      });

      const worker = Effect.gen(function*() {
        while (true) {
          const { wait, job } = yield* next;
          if (Option.isSome(job)) {
            yield* draw(job.value).pipe(
              Effect.catchTag("ImageError", (error) => failed(job.value, error.message)),
              Effect.catchCause((cause) => Effect.logError("A cover could not be drawn", cause).pipe(Effect.andThen(failed(job.value, UNFINISHED)), Effect.ignore)),
              Effect.ensuring(Effect.sync(() => drawing.delete(job.value.asset))),
            );
          } else if (Option.isSome(wait)) {
            // Over the day's limit: look again when it eases, or sooner if something changes.
            yield* Effect.raceFirst(Effect.sleep(Math.min(wait.value, 60_000)), Queue.take(wake));
          } else {
            yield* Queue.take(wake);
          }
        }
      });
      if (configured) {
        for (let n = 0; n < settings.workers; n++) yield* Effect.forkScoped(worker);
        // What a restart left queued carries on.
        yield* Queue.offer(wake, undefined);
      }

      return Covers.of({
        library: Effect.sync((): CoverLibrary => ({
          configured, paused,
          docs: Object.fromEntries([...manifests.values()].map((manifest) => {
            const article = manifest.covers[0];
            const url = urlOf(article);
            return [manifest.docId, {
              status: article.status, ...(url ? { url } : {}),
              pending: manifest.covers.filter(waiting).length, failed: manifest.covers.filter((entry) => entry.status === "failed").length,
            }];
          })),
        })),
        document: (docId) => Effect.suspend(() => {
          const manifest = manifests.get(docId);
          return manifest ? Effect.succeed(wire(manifest)) : Effect.fail(new DocumentMissing({ docId }));
        }),
        ensure: Effect.fn("Covers.ensure")(function*(docId: string, retry = false) {
          if (!configured) return yield* new CoversUnavailable({ message: settings.enabled ? "OpenAI image generation is not configured on this server." : "Covers are switched off on this server." });
          const doc = yield* documents.get(docId);
          if (Option.isNone(doc)) return yield* new DocumentMissing({ docId });
          return wire(yield* exclusive(reconcile(doc.value, retry)));
        }),
        added: (doc) => configured ? exclusive(reconcile(doc, false)).pipe(Effect.asVoid) : Effect.void,
        changed: (doc) => Effect.suspend(() => configured && manifests.has(doc.id) ? exclusive(reconcile(doc, false)).pipe(Effect.asVoid) : Effect.void),
        forget: (docId) => exclusive(Effect.suspend(() => manifests.has(docId)
          ? files.removeManifest(docId).pipe(Effect.tap(() => Effect.sync(() => manifests.delete(docId))))
          : Effect.void)),
        image: files.image,
      });
    }),
  );
}
