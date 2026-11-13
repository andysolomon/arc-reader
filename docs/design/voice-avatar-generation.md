# Voice avatars

`VoiceAvatar` renders the same character in the player, voice cards, Studio gallery,
compose selector and settings. The service-colored ring stays visible around generated
portraits: VoiceStudio green, Phonon teal, ChatGPT lavender and Fish coral.

The built-in catalog and featured Studio recipes have curated SVG illustrations. Every
built-in character has a different silhouette/accessory combination. Studio recipes use
explicit gender/age metadata (or the saved voice-design description), and retain their
identity when saved from the gallery. Unknown demographic metadata produces a neutral
fictional character; a clone's recording is not analyzed or sent to the image service.

## Automatic portraits

When the web app loads its voice catalog, or cloning/designing/discovery adds a voice,
`startAvatarSync` requests portraits for voices without curated artwork. Browsing the
unsaved Studio gallery alone does not create paid requests. A deterministic SVG appears
immediately, and the saved image replaces it throughout the app when ready. The image
button on a voice card also creates a portrait on demand or retries a failed request.

The Vite server plugin at `/api/avatars` uses the existing server-side `OPENAI_API_KEY`
and `OPENAI_URL`. No key is sent to the browser. The default model is `gpt-image-2`,
quality `low`, one 1024×1024 PNG per voice. `AVATAR_IMAGE_MODEL` in the server environment
can override the model. Image requests are billed to that OpenAI account. Only voice
metadata and illustration direction are submitted, not recordings or reading material.

The queue processes one image at a time, deduplicates concurrent devices, and persists
metadata and PNGs under `LIBRARY_DATA_DIR/avatars`. This is inside the existing library
volume in production. Renaming a voice, changing a profile's synthesis engine, or opening
another device reuses the image. Presets are identified by engine and voice ID; Studio
recipes by archetype ID; clones and custom designs by profile ID. Images have immutable
versioned URLs. A removed profile's image remains cached, so re-adding a recipe reuses it.

Queued work survives a server restart. A request interrupted while generating, or a
provider failure, requires explicit retry to avoid repeated billing. The Voices page
shows pending/failed counts and retry controls. API failures, missing configuration and
image load errors retain the SVG. In a native shell serving bundled offline files there
is no avatar server, so it uses local illustrations; a shell loading the hosted app uses
the same portraits as the web app.

API:

- `GET /api/avatars/`: configuration availability and saved job statuses/URLs.
- `POST /api/avatars/ensure`: `{ voice, retry?: boolean }`; returns an existing or queued
  job. Only failed jobs are retried. Ready images are reused.
- `GET /api/avatars/images/:versionedFilename`: saved PNG.

The endpoints use the app's existing access gate. Writes require JSON, reject other
origins and oversized/invalid metadata, and never expose upstream response bodies or keys.
