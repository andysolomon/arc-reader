# Article covers

Every article has a cover, and every section under a heading has its own. This follows the
`arc-article-to-images` skill (arc-skills): one cover for the article, one for each real
section including nested ones, no fixed count, and nothing invented for a section with no
text. The reader experience and the reasons are in the README under **Article covers**; this
page is how it is built.

## What a cover is

A cover is two things put together in the app:

- **Art**: one square pen-and-ink illustration with a single cobalt detail and no lettering,
  drawn by an image model.
- **Type**: the article's title or the section's heading, a small label above it and a foot
  line, set by `Cover` (`apps/web/src/components/Cover.tsx`) on its own off-white page at 4:5.

The skill calls this the hybrid route. It is used because nobody inspects each image before
a reader sees it: a model that letters a title can misspell it, and the app cannot. It also
means a cover shows its title the moment it exists and the art fades in later, the heading
stays real text for screen readers and listening positions, and the art's description is its
alt text.

The art comes back on paper a shade off the cover's, so `.cover-art` lifts the lightest tones
to white and multiplies the drawing onto the page. No rectangle shows around it.

## Which covers a document has

`coverPlan` (`apps/web/src/lib/covers.ts`) reads a document the way the Reader does
(`readingBlocks`, then `proseParts`), so headings inside code and picture metadata are not
sections. It returns the article first and then every section in reading order, each with:

- `key`: a hash of the headings above it and its own, plus its place among sections with the
  same path. Two "Notes" headings are two sections. A key survives edits elsewhere.
- `path`, `level`, `parent`: where it sits.
- `ordinal`: which of the document's headings it is, as the Reader counts them.
- `body`: its prose and the sections inside it. Code and pictures are left out.

A heading that repeats the title is the article, not a section. A section with an empty
`body` is `blocked`: it is listed, and nothing is drawn for it.

The server and the Reader both import this file, so they agree on what is where.
`coverPlaces` maps each section to the paragraph its cover goes before, and places nothing
when the text on screen has a different number of headings (a Patois rewrite, a summary).

## The service, on Effect

The server side is the first part of the app written with [Effect](https://effect.website)
(v4, `effect ~4.1`). It lives in three files beside the other server routes:

| File | What it holds |
| --- | --- |
| `apps/web/vite.covers.service.ts` | The services, their layers, and the worker |
| `apps/web/vite.covers.prompt.ts` | The image prompt and the art director's instructions |
| `apps/web/vite.covers.ts` | The layer wiring, the HTTP routes, and the Vite plugin |

Each outside dependency is a `Context.Service` with a layer, so a test swaps it without
touching the rest:

| Service | Job | Live layer |
| --- | --- | --- |
| `CoverSettings` | Model, size, limits, key | `coverConfig(env)` |
| `CoverFiles` | Manifests, art, sheets, the day's count; atomic writes | `CoverFiles.layer` (node:fs) |
| `ImageModel` | One picture for one prompt | `ImageModel.layerOpenAi(fetch)` |
| `ArtDirector` | What each cover should show | `ArtDirector.layerChat(keys, url)` or `layerNone` |
| `Documents` | A document by id | `Documents.layerLibrary(libraryService)` |
| `Covers` | Reconcile, queue, draw, report | `Covers.layer` |

Errors are tagged (`ImageError`, `CoverStorageError`, `CoversUnavailable`,
`DocumentMissing`) and the routes turn each into a status with `Effect.catchTags`. What is
read from disk or from a provider is decoded with `Schema`; a file or an answer that does not
decode is treated as absent, never trusted.

`coverRuntime` builds one `ManagedRuntime` per server. The Vite plugin (`articleCovers`)
mounts the routes, subscribes to the library, and disposes the runtime when the server
closes, which interrupts the workers.

### Reconcile

`Covers.ensure(docId, retry)`, and the library hook, run `reconcile` under a one-permit
semaphore. For each section of the plan:

1. Its **asset** is `sha256` of the style version, model, size, quality, kind, heading path
   and body. The title is not part of it, so renaming an article redraws nothing.
2. If the document already has a cover with that key and asset, it is kept as it is. A failed
   one is queued again only when `retry` is set.
3. Otherwise, if art for that asset exists (the same text was drawn before, in any document),
   the cover is ready at once.
4. Otherwise it is queued.

So an edit to one section queues that section and the article (whose body is the whole text)
and leaves the rest alone.

### The worker

`COVER_WORKERS` fibers (one by default) are forked into the layer's scope. Each takes the
next queued cover: article covers before sections, then the document asked for most
recently, then reading order. For one cover it:

1. Looks the document up again. If the text moved on, it reconciles instead of drawing what
   the document no longer says. If the document is gone, it drops the manifest.
2. Asks the `ArtDirector` once for every cover of that article still waiting. One request
   (batches of 16) returns a subject, a cobalt detail and alt text per cover, with the rule
   that each gets a different object. No key, an error or an answer that does not decode all
   mean fewer directions; those covers are drawn from their text alone.
3. Counts the request against the day's limit, then asks `ImageModel` for the art. A 429 or
   5xx was not billed and is retried twice with backoff. A dropped connection, a timeout or
   an invalid picture is not retried: it may have been billed.
4. Saves the art, then a **sheet** beside it (prompt, model, settings, direction), then
   marks every cover waiting on that asset ready, in every document.

A failure marks the cover `failed` with a message that never carries a provider's response.
After a restart, queued covers carry on and one that was mid-request is `failed` until
someone presses **Draw again**.

When the limit (`COVER_DAILY_LIMIT` in any 24 hours) is reached the workers wait and
`paused` is reported; nothing is dropped.

### Following the library

`LibraryService.subscribe` reports each commit's added, changed (title or text) and deleted
documents. Added documents are reconciled, so a document gets covers however it arrived:
pasted on a phone, synced from another device, or imported as a book chapter by the server.
A changed document is reconciled only if it already has covers. A deleted one loses its
manifest; its art stays for reuse.

Documents from before this feature get covers the first time they are opened: the Reader
calls `ensure`.

## Storage

Under `LIBRARY_DATA_DIR/covers`:

```
docs/<sha256 of doc id>.json      the document's covers and their states
assets/<asset>.json               the sheet: prompt, model, settings, direction, file name
images/<asset>-<uuid>.webp        the art (.png when COVER_IMAGE_FORMAT=png)
usage.json                        when each request of the last day was made
```

A file name is never reused for different art, so images are served `immutable` and the
service worker keeps them (`covers` cache) for offline reading. Art is about 150 KB as WebP.
Nothing removes art when a document is deleted.

## API

All under `/api/covers`, behind the app's access gate.

- `GET /` → `{ configured, paused, docs: { [docId]: { status, url?, pending, failed } } }`.
  The Library polls it (with `If-None-Match`) for each article's cover.
- `GET /docs/:id` → `{ docId, style, headings, covers: [{ key, kind, heading, path, level,
  ordinal, parent, status, url?, alt, error?, updated }] }`, or 404 when it has none.
- `POST /docs/:id/ensure` with `{ "retry"?: boolean }` → 202 and the same shape. 404 when
  the document is not in the library, 503 without an image key or with `COVERS=off`.
  Same-origin JSON only.
- `GET /images/:name` → the art.

`status` is `queued`, `generating`, `ready`, `failed` or `blocked`.

## The app

- `useCovers` (`apps/web/src/state/covers.ts`) holds the Library's summaries and opened
  documents' covers. `useDocCovers` asks for a document's covers when it is opened and
  follows them every four seconds until none is pending.
- `Reader` shows the article's cover above the title block and passes section covers to
  `SentenceText` as `inserts`, keyed by paragraph. Covers are not sentences: they have no
  listening position and are not read aloud. Focus mode and the summary show none.
- `DocMark` leads a Library row or card with the cover's art once it is ready.
- **Settings → Covers** (`showCovers`) hides covers on that device and stops the Reader
  asking for them. The server still makes covers for new documents.
- The iOS app running its own bundled files has no server, so it shows none.

## Settings

Server environment, all optional. The deployments pass `COVERS` and `COVER_DAILY_LIMIT` from
the root `.env` through Terraform into `readaloud-config`.

| Name | Default | |
| --- | --- | --- |
| `COVERS` | on | `off` makes none and answers 503 |
| `COVER_DAILY_LIMIT` | `200` | New art in any 24 hours |
| `COVER_IMAGE_MODEL` | `gpt-image-2` | |
| `COVER_IMAGE_QUALITY` | `low` | |
| `COVER_IMAGE_SIZE` | `1024x1024` | |
| `COVER_IMAGE_FORMAT` | `webp` | or `png` |
| `COVER_WORKERS` | `1` | 1 to 4 |
| `COVER_DIRECTION_MODEL` | `muse-spark-1.3-contributor` | On `LLM_URL`, with the summaries key |

Changing the model, size or quality, or `COVER_STYLE` in `covers.ts`, changes every asset
fingerprint: covers are then redrawn as documents are opened or changed, not all at once.

## Tests

- `apps/web/src/lib/covers.test.ts`: the plan and where covers are placed.
- `apps/web/vite.covers.test.ts`: the service against a temporary directory and stand-in
  providers: ordering, reuse, failures and retries, restarts, the daily limit, art
  direction, the library hook and the routes.
- `apps/web/tests/e2e/covers.spec.ts`: the Reader, Library and Settings against a stand-in
  `/api/covers`. The end-to-end server runs with `COVERS=off` so no other test draws.

## Not done

- A book or series has no cover of its own; each chapter is an article with its own.
- No "draw a different one" for a cover that is ready.
- Covers are not put into exported audiobooks.
- Nothing prunes art for deleted documents.
