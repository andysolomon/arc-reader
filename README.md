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
pnpm dev              # app on http://127.0.0.1:5173
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
- Chunks are cached in IndexedDB (`audio` store) so documents replay offline. Positions persist per document (`positions` store) and drive the Library progress rings.
- Provider chain: cache → cloud API → local voice. When the API is unreachable, a banner appears and the browser speech engine reads instead (shown as the local voice).

### API contract

`POST {VITE_API_BASE}/tts` with `{ text, voice, provider, format: "mp3" }` returning either

- `audio/mpeg` body, optional headers `X-Duration` (seconds) and `X-Word-Timings` (JSON `[[start, end], …]` in seconds), or
- `application/json` `{ audio: <base64>, mime, duration, words: [{ start, end }] }`.

`POST {VITE_API_BASE}/auth/magic-link` and `GET {VITE_API_BASE}/auth/google` back the Auth screen. With no `VITE_API_BASE`, the app runs fully local.

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
