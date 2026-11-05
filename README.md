<img src="assets/icon.svg" width="64" height="64" alt="">

# ReadAloud

Paste anything. Hear it read. A React + Vite PWA that streams text-to-speech per sentence, highlights what is being read, remembers your place, and works offline with a local voice.

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
```

Copy `apps/web/.env.example` to `.env` to point the app at a TTS backend.

## Playback engine (`apps/web/src/engine`)

- One audio chunk per sentence; the next two are prefetched.
- Advances with `requestAnimationFrame` on real elapsed time. With audio, `audio.currentTime` is the clock. Without provider timestamps, word timing is estimated at 2.83 words/s × speed.
- Chunks are cached in IndexedDB (`audio` store, keyed by engine + voice + text) so documents replay offline. Positions persist per document (`positions` store) and drive the Library progress rings.
- Provider chain: cache → speech server → browser voice. When the server is unreachable, a banner appears and the browser speech engine reads instead.

## Voices: VoiceStudio

ReadAloud talks to [VoiceStudio](https://github.com/debpalash/VoiceStudio) through its OpenAI-compatible audio API. The browser never contacts VoiceStudio directly: the Vite dev and preview servers proxy `/api/vs/*` to it and inject the API key, so the key stays out of the bundle and VoiceStudio only hears from loopback.

### 1. Run VoiceStudio (CPU, Docker)

Your user needs access to the Docker socket (`sudo usermod -aG docker $USER`, then log in again).

```sh
export OMNIVOICE_API_KEY="$(openssl rand -hex 32)"
docker run -d --name voicestudio \
  -p 127.0.0.1:3900:3900 \
  -e OMNIVOICE_API_KEY \
  -e OMNIVOICE_SERVER_MODE=1 \
  -e OMNIVOICE_ANALYTICS_DISABLED=1 \
  -e OMNIVOICE_DATA_DIR=/app/omnivoice_data \
  -v voicestudio-data:/app/omnivoice_data \
  ghcr.io/debpalash/voicestudio:stable
echo "$OMNIVOICE_API_KEY"
```

Open http://127.0.0.1:3900, pick **KittenTTS** in the Model Manager (about 80 MB, runs on any CPU), and let it download. Pin the image to a `:sha-…` tag once it works; the project ships often.

Measured on this laptop (Intel i7, 12 threads, CPU only, KittenTTS warm; the first request after a cold start also downloads the 80 MB model and took about 19 s):

| Sentence | Words | First byte | MP3 size |
|---|---|---|---|
| "Simplicity, simplicity, simplicity!" | 3 | 0.87 s | 60 KB |
| "I went to the woods because I wished to live deliberately." | 11 | 1.2 s | 240 KB (WAV) |
| "The quick brown fox … begin to call." | 22 | 2.3 s | 156 KB |

Generation runs at roughly 3–4× real time, so the two-sentence prefetch keeps up once playback starts. MP3 is the cheapest format; WAV and PCM save nothing on latency. Cloned profiles play in the active engine's default voice unless a cloning engine (OmniVoice, VoxCPM2, CosyVoice, PocketTTS, MOSS) is selected; KittenTTS cannot clone. Re-measure with `apps/web/scripts/measure-tts.sh`:

```sh
apps/web/scripts/measure-tts.sh            # three runs, first-byte and total time
```

Select the engine without the UI if you prefer:

```sh
curl -X POST -H "Authorization: Bearer $OMNIVOICE_API_KEY" -H "Content-Type: application/json" \
  -d '{"family":"tts","backend_id":"kittentts"}' http://127.0.0.1:3900/engines/select
```

### 2. Point ReadAloud at it

Create `apps/web/.env.local`:

```sh
VITE_API_BASE=/api/vs
VITE_TTS_PROVIDER=openai
VITE_DEFAULT_ENGINE=kittentts
VOICESTUDIO_URL=http://127.0.0.1:3900
VOICESTUDIO_API_KEY=<the key you printed above>
```

Then `npm run dev` (or `pnpm build && pnpm --filter @readaloud/web preview` for the tailnet build). The Voices page lists KittenTTS's eight presets plus any profiles you clone in VoiceStudio; Settings → Engine lists what the server reports.

### Without VoiceStudio

`LIVE=1 pnpm test:e2e` runs the `@live` specs against a real server (URL and key from `.env.local`) and prints the measured first-sentence latency. Without the flag, `tests/stub-voicestudio.mjs` imitates the API (bearer check, two cloned profiles, sine-tone audio, word timings). Playwright starts it automatically. To develop against it:

```sh
node apps/web/tests/stub-voicestudio.mjs 3999 test-key &
VOICESTUDIO_URL=http://127.0.0.1:3999 VOICESTUDIO_API_KEY=test-key VITE_API_BASE=/api/vs npm run dev
```

### Word timings (optional)

The speech endpoint returns audio only, so the word underline is estimated. Settings → Playback → **Word timings from the server** sends each synthesized sentence to `/v1/audio/transcriptions` (`verbose_json`, word granularity) and uses the result when every word aligns. It costs one extra request per sentence and is off by default.

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
