<img src="assets/icon.svg" width="64" height="64" alt="">

# ReadAloud

Paste anything. Hear it read. A React + Vite PWA that streams text-to-speech passage by passage, highlights the sentence being read, remembers your place, and works offline with a local voice.

## Layout

```
apps/web          The app (Vite + React 18 + TypeScript, React Router, Zustand, Framer Motion, PWA)
packages/ui       Component library (Tailwind + Morphicons + Lucide) with Storybook
packages/tokens   CSS variables for all 8 themes, a Tailwind preset, and a WCAG contrast check
```

## Scripts

```sh
pnpm install
npm run dev          # app on http://127.0.0.1:5181 (strict port, .ts.net allowed); also prints the Tailnet URL from `tailscale serve`
pnpm build            # production build → apps/web/dist
pnpm --filter @readaloud/web preview   # serve the build on :4173
pnpm storybook        # Storybook on :6006 (dark / light / all Omarchy themes in the toolbar)
pnpm typecheck
pnpm test             # tokens contrast check + vitest unit tests
pnpm test:e2e         # Playwright: keyboard flow, responsive, axe per screen per theme
pnpm contrast         # WCAG 2.2 AA table for every theme
docker compose up -d  # VoiceStudio + the built app on :4179 (see Voices below)
```

Copy `apps/web/.env.example` to `.env` to point the app at a TTS backend.

## Playback engine (`apps/web/src/engine`)

- One audio clip per passage (a paragraph, or up to about 60 words of one); the next two are prefetched. The reader still moves sentence by sentence: each clip's sentence starts are located from its pauses (or from word timings when enabled), clips are level-matched and their edge silences trimmed at the joins. One request per sentence made generative voices shift tone at every sentence; see `planPassages` in `src/lib/segment.ts`.
- Advances with `requestAnimationFrame` on real elapsed time. With audio, `audio.currentTime` is the clock. Without provider timestamps, word timing is estimated at 2.83 words/s × speed.
- Chunks are cached in IndexedDB (`audio` store, keyed by engine + voice + text) so documents replay offline. Positions persist per document (`positions` store) and drive the Library progress rings.
- Provider chain: cache → speech server → browser voice. When the server is unreachable, a banner appears and the browser speech engine reads instead.

## Voices: VoiceStudio

ReadAloud talks to [VoiceStudio](https://github.com/debpalash/VoiceStudio) through its OpenAI-compatible audio API. The browser never contacts VoiceStudio directly: the Vite dev and preview servers proxy `/api/vs/*` to it and inject the API key, so the key stays out of the bundle and only the proxy talks to VoiceStudio.

### 1. Run VoiceStudio and ReadAloud (Docker Compose)

Your user needs access to the Docker socket (`sudo usermod -aG docker $USER`, then log in again). `compose.yaml` defines VoiceStudio (CPU) with its `voicestudio-data` volume and the web app, built and served by `vite preview` with its proxies. It reads settings from `.env` in the repo root (gitignored):

```sh
echo "VOICESTUDIO_API_KEY=$(openssl rand -hex 32)" > .env
# optional: OPENAI_API_KEY=sk-...   FISH_API_KEY=...   VOICESTUDIO_TAG=sha-...   WEB_PORT=4179
docker compose up -d
```

If you already have `apps/web/.env.local`, `ln -s apps/web/.env.local .env` uses it as-is; the variable names match. The app is at http://127.0.0.1:4179 and VoiceStudio at http://127.0.0.1:3900, both on loopback only. Both containers restart with Docker. OpenAI and Fish voices appear when their keys are set. Model names and the default engine (`VITE_DEFAULT_ENGINE`, `VITE_OPENAI_TTS_MODEL`, `VITE_PATOIS_MODEL`, `VITE_FISH_TTS_MODEL`) can also go in `.env`. Provider choices are baked in at build time, so run `docker compose up -d --build` after changing `.env` or pulling new code. To publish on the tailnet, run `tailscale serve --bg --https=<port> http://127.0.0.1:4179`.

#### VoiceStudio on another machine

Cloned and designed voices use OmniVoice, which runs about 10× slower than real time on a laptop CPU. On an Apple Silicon Mac it uses the GPU (MPS) and runs faster than real time. To use VoiceStudio on such a machine, run its backend there from source with the same API key, and publish it on the tailnet:

```sh
git clone --depth 1 --branch v0.5.7 https://github.com/debpalash/VoiceStudio.git && cd VoiceStudio
uv sync --locked --python 3.11 --managed-python && uv run --no-sync python scripts/setup.py
OMNIVOICE_API_KEY=<VOICESTUDIO_API_KEY> OMNIVOICE_SERVER_MODE=1 .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 3900
tailscale serve --bg --https=3900 http://127.0.0.1:3900
```

Then set `VOICESTUDIO_REMOTE_URL=https://<machine>.<tailnet>.ts.net:3900` in `.env` and run `docker compose up -d`. The web container uses the remote server; the local VoiceStudio container still starts but receives no requests (`docker compose stop voicestudio` frees its memory). For `npm run dev`, set `VOICESTUDIO_URL` to the same address. The remote server keeps its own voices and licence acceptances: accept the OmniVoice licences there and recreate any designed or cloned voices.

The volume has a fixed name, so models downloaded by an earlier `docker run -v voicestudio-data:…` carry over. Remove the old container first (`docker rm -f voicestudio`). Compose then warns once that the volume already exists; that is expected.

Open http://127.0.0.1:3900, pick **KittenTTS** in the Model Manager (about 80 MB, runs on any CPU), and let it download. Pin the image with `VOICESTUDIO_TAG=sha-…` in `.env` once it works; the project ships often.

Measured on this laptop (Intel i7, 12 threads, CPU only, KittenTTS warm; the first request after a cold start also downloads the 80 MB model and took about 19 s):

| Sentence | Words | First byte | MP3 size |
|---|---|---|---|
| "Simplicity, simplicity, simplicity!" | 3 | 0.87 s | 60 KB |
| "I went to the woods because I wished to live deliberately." | 11 | 1.2 s | 240 KB (WAV) |
| "The quick brown fox … begin to call." | 22 | 2.3 s | 156 KB |

Generation runs at roughly 3–4× real time, so the two-passage prefetch keeps up once playback starts (the numbers above are per sentence; a passage request is a few sentences long). MP3 is the cheapest format; WAV and PCM save nothing on latency. Saved profiles require an active cloning engine; ReadAloud checks this before requesting speech and reports an explicit browser fallback if it is unavailable. KittenTTS cannot clone. Re-measure with `apps/web/scripts/measure-tts.sh`:

```sh
VOICESTUDIO_API_KEY=… apps/web/scripts/measure-tts.sh   # three runs, first-byte and total time; or reads apps/web/.env.local
```

Select the engine without the UI if you prefer:

```sh
set -a; . ./.env; set +a
curl -X POST -H "Authorization: Bearer $VOICESTUDIO_API_KEY" -H "Content-Type: application/json" \
  -d '{"family":"tts","backend_id":"kittentts"}' http://127.0.0.1:3900/engines/select
```

### 2. Develop against it

To run the app with `npm run dev` against the Compose VoiceStudio, create `apps/web/.env.local` with the same key:

```sh
VITE_API_BASE=/api/vs
VITE_TTS_PROVIDER=openai
VITE_DEFAULT_ENGINE=kittentts
VOICESTUDIO_URL=http://127.0.0.1:3900
VOICESTUDIO_API_KEY=<VOICESTUDIO_API_KEY from .env>
```

Then `npm run dev`. The Voices page lists KittenTTS's eight presets plus any cloned or designed profiles; Settings → Engine lists what the server reports.

### Studio

Open **Studio** to clone a voice, design one from a description, browse VoiceStudio’s designed-voice gallery, dictate, transcribe files, or dub a video. The required model terms can be reviewed and accepted in Studio. See [Studio setup and verification](docs/voicestudio-studio.md) for API details and the remaining live-render verification gate.

### OpenAI voices (the ChatGPT voices)

The same adapter talks to OpenAI's speech endpoint. Add to `apps/web/.env.local`:

```sh
VITE_OPENAI_BASE=/api/oa
VITE_OPENAI_TTS_MODEL=gpt-4o-mini-tts   # or tts-1 / tts-1-hd
OPENAI_API_KEY=sk-...                     # read by the proxy only
```

The Voices page then lists Alloy, Ash, Ballad, Coral, Echo, Fable, Nova, Onyx, Sage, Shimmer and Verse. Each voice carries its own engine, so OpenAI voices go to `/api/oa` and VoiceStudio voices to `/api/vs`; Settings → Engine selects VoiceStudio’s active engine for saved profiles or enables the browser-voice override. OpenAI requests are not serialized (it handles concurrency); clips are still cached at 1×. Settings → API usage & spending shows monthly requests, reported input/audio output tokens, and list-price cost estimates. GPT-4o mini TTS requests use speech events to retain reported usage; binary-only compatible servers remain playable, with tokens and cost marked unavailable. Every gpt-4o-mini-tts request also carries a fixed `instructions` line asking for one steady delivery, so passages match each other. Every passage sent to an OpenAI voice leaves the machine; VoiceStudio keeps everything local.

### Fish Audio voices

Add to the ignored `apps/web/.env.local` and restart Vite (rebuild for preview):

```sh
VITE_FISH_BASE=/api/fish
VITE_FISH_TTS_MODEL=s2.1-pro
FISH_API_KEY=<your Fish Audio API key>
```

The key is read only by the server proxy; never put it in a `VITE_` variable or the browser's Settings API-key field. Keep `.env.local` private (`chmod 600 apps/web/.env.local`). The proxy allows voice catalogue reads and speech generation only. Static hosting needs an equivalent backend proxy; Vite dev and preview include it.

Choose a voice tagged **Fish Audio** on the Voices page. Sarah, **Jamaican English**, and **Jamaican Patois** are always included when Fish is enabled, alongside up to 12 English voices from Fish's catalogue. A failed refresh displays a retry action and keeps the existing voices available. Saved Fish voice IDs remain playable even if they fall outside the current catalogue page.

Jamaican English uses Fish's [Jamaican Accent Male](https://fish.audio/m/d7988a7138db47cc8a4876a36625dff6/) to read the original wording. **Jamaican Patois rewrites English into Jamaican Patois**, then reads the adaptation with [Jamaican Patois Male](https://fish.audio/m/0724e14ccf884007a641908722575fdf/). Use **Preview** to audition each voice, then select it globally or for an individual document.

Patois rewriting requires `VITE_OPENAI_BASE=/api/oa` and the server-side `OPENAI_API_KEY` above. It uses `gpt-4.1-mini` by default (`VITE_PATOIS_MODEL` overrides it) through the existing OpenAI proxy. Source text is sent to OpenAI in bounded chunks; adapted text goes to Fish. Text-model token charges are separate from the speech-character estimates in Settings. The reader displays and highlights the adapted text. The original and completed adaptation are stored together on this device, so repeat listening reuses the rewrite; switching to another voice restores the original. Positions reset when changing between original and adapted text. Failed, cancelled, refused, or truncated rewrites do not start speech or replace the original. The preparation banner offers cancel and retry. Adaptation quality still benefits from a fluent speaker's review.

Fish uses [`POST /v1/tts`](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech) with the voice's `reference_id` and returns MP3 audio. Passage prefetch, playback speed, cache, and character usage work as before. Fish caches include the selected model, and cloud requests run independently of the local worker queue. Changing voices retries the connection after an offline fallback. Word highlighting uses estimated timing unless the existing optional VoiceStudio alignment is enabled.

`s2.1-pro` requires API credit; an insufficient-credit response is shown without marking all providers offline. Other models can be selected using `VITE_FISH_TTS_MODEL`; consult Fish's current model documentation before changing it. Text read with a Fish voice is sent to Fish Audio. Leave `VITE_FISH_BASE` empty to hide this provider.

### API usage & spending

Settings groups speech usage by provider and model, with monthly history and a daily spend chart. Only completed generations are recorded, including prefetch; cached playback and browser voices add no usage. OpenAI GPT-4o mini TTS uses provider-reported input and audio output tokens; TTS-1 uses Unicode character counts, and Fish uses UTF-8 bytes. Prices are snapshots of list rates checked November 5, 2026 ([OpenAI](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [TTS-1](https://developers.openai.com/api/docs/models/tts-1), [TTS-1 HD](https://developers.openai.com/api/docs/models/tts-1-hd), [Fish Audio](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)). Unknown models or missing usage show unavailable costs rather than a guessed rate.

Daily aggregates live in `readaloud:usage` in this browser's local storage. They contain no API keys, document text, or audio. Keys used with the same provider share totals; other devices, apps, Studio operations (including dubbing/transcription), hosting costs, tax, and credits are excluded. Failed/interrupted requests may still incur provider charges. Account links lead to actual billing information. Clearing site data clears history. Existing character counters migrate with their original month; their missing model, token, and cost data stays unavailable. Estimates are saved when generated so changing a model or rate does not reprice history.

### Slow engines (cloned voices on CPU)

Cloning engines such as OmniVoice are built for a GPU. On a CPU they can take ten times longer to generate a passage than to play it, so the reader pauses between passages while the next one renders (the player's spinner shows the wait). The app detects this and points to **Prepare audio** in the player menu: it renders the whole document into the cache from the current passage onward, with progress beside the time, and can run while paused or in the background. Playback from the cache is gapless, also on later visits. For live reading choose a KittenTTS voice (CPU-native, faster than real time) or an OpenAI voice.

### Without VoiceStudio

`LIVE=1 pnpm test:e2e` runs the `@live` specs against a real server (URL and key from `.env.local`) and prints the measured first-sentence latency. Without the flag, `tests/stub-voicestudio.mjs` imitates the API (bearer check, two cloned profiles, sine-tone audio, word timings). Playwright starts it automatically. To develop against it:

```sh
node apps/web/tests/stub-voicestudio.mjs 3999 test-key &
VOICESTUDIO_URL=http://127.0.0.1:3999 VOICESTUDIO_API_KEY=test-key VITE_API_BASE=/api/vs npm run dev
```

### Word timings (optional)

The speech endpoint returns audio only, so the word underline is estimated. Settings → Playback → **Word timings from the server** sends each synthesized passage to `/v1/audio/transcriptions` (`verbose_json`, word granularity) and uses the result when every word aligns; the timings then also fix the sentence starts inside the clip. It costs one extra request per passage and is off by default.

### Legacy contract

With `VITE_TTS_PROVIDER=readaloud` the app instead calls `POST {VITE_API_BASE}/tts` with `{ text, voice, provider, format: "mp3" }` and accepts `audio/mpeg` (optional `X-Duration`, `X-Word-Timings` headers) or JSON `{ audio: <base64>, mime, duration, words }`. `POST /auth/magic-link` and `GET /auth/google` back the Auth screen in either mode.

## Themes

`packages/tokens/src/themes.css` defines `--bg … --danger` on `html[data-theme]` for dark, light, tokyo-night, catppuccin, gruvbox, nord, everforest and kanagawa. The Tailwind preset maps `bg-bg2`, `text-fg2`, `border-line`, `bg-hl`, `rounded-card`, `shadow-overlay` and so on to those variables. First visit follows `prefers-color-scheme`; the rail and reader header cycle themes.

`pnpm contrast` verifies WCAG AA for text on every surface, including `--fg` on `--hl` composited over `--bg` in every theme.

### Deviations from the brief, for accessibility

- Light accent is `#a35b25` rather than `#b5692d`. The original fails AA for white text on the Listen button (4.18:1) and for accent-coloured links on the light background (3.74:1).
- `--fg3` is never used for running text. The dim highlight mode uses it for inactive sentences as specified; this is below 4.5:1 in several themes and is a deliberate de-emphasis. Placeholders use `--fg2`.
- The Waybar mockup's accent-on-`--hl` speaking state is below AA in light, tokyo-night, nord and everforest. It mirrors the real Waybar module, whose colours come from Omarchy, and is reported as advisory by the contrast script.

## Keyboard

Space play/pause · ← → sentences · [ ] speed ±0.25 · ⌘↵ Listen · F focus · / search library · ? shortcuts · Esc exit/close. Ignored while typing, except Esc and ⌘↵.

## PWA

Manifest with icons, maskable icon and a splash screenshot. Web Share Target opens `/read/new?text=&url=&title=`; it auto-plays only when "Auto-play on share" is on.
