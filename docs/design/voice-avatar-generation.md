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

## Jev design direction

Before a new image is generated, the server reuses the same TypeSafe key as library
categorization (`typesafe.json`, with `TYPESAFE_API_KEY` as fallback). A single text-only
Jev request checks personality, age/gender consistency, and four candidate designs.
The shortlist compares against all curated portraits plus saved generated directions;
Jev sees up to six nearest designs per candidate. Skin, gender and engine color alone
never count as distinguishing features. The local comparison considers character,
hairstyle, accessories, face shape and outfit.

Jev selects from fixed choices. Personality and candidate choices require confidence
of at least 0.7; otherwise the local direction remains. A candidate flagged as similar
with probability at least 0.8 can be replaced by one with similarity probability at most
0.3. If none meets that threshold, the record and voice card flag it for review. Metadata
conflicts and missing traits are also recorded and shown on the voice card. Jev cannot
rewrite age or gender: explicit metadata is authoritative and unknown traits retain the
neutral/adult defaults. Names may inform a fictional role's personality, never demographics.

The chosen direction and review are saved before the OpenAI request. Image retries with
unchanged voice metadata reuse that direction. Ready images are reused as before; this
feature does not regenerate existing avatars. Missing credentials, invalid answers,
HTTP errors or the 20-second Jev timeout fall back to the local design. Raw errors and
credentials are never exposed. These confidence thresholds are conservative starting
values, not a guarantee of visual uniqueness.

This checks design descriptions. Experimental image inspection is not enabled, and Jev
never automatically triggers another paid image generation.
