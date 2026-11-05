# ReadAloud Studio

`/studio` connects directly to the installed VoiceStudio 0.5.7 API through the existing server-side `/api/vs` proxy. API credentials stay in the ignored `apps/web/.env.local` file.

- **Clone:** upload or record a reference, optionally provide its transcript, and create a clone profile with multipart `POST /profiles`.
- **Design:** `POST /design/describe` maps descriptions onto the model's supported attributes. Unsupported words are displayed before saving the recipe with `kind=design`, `vd_states`, and a deterministic seed.
- **Gallery:** browse/search/paginate the actual `/archetypes` catalog, preview samples, and import recipes with `/archetypes/{id}/use`. Saved designs are distinguished from clones in Voices.
- **Dictate / transcribe:** microphone recordings and uploaded audio/video use `/transcribe` with the selected local ASR engine. Recordings are transcribed on stop; this is not streaming dictation. Text can be edited, downloaded, or saved to Library. Timed transcripts export SRT; editing plain text disables SRT export rather than exporting stale edits.
- **Dub:** upload video, follow the preparation SSE task, transcribe or import SRT/VTT, edit timed lines, choose a saved profile, optionally translate, then generate and download video/audio/subtitles. Google translation explicitly sends transcript text online; manual editing needs no translation service. The current draft and task ID persist in this browser. Resume progress after reload; cancel calls both the task cancellation and dub-abort endpoints.

The implementation follows the installed backend's `profiles.py`, `archetypes.py`, `capture.py`, `describe_voice.py`, `dub_core.py`, `dub_generate.py`, `dub_translate.py`, `dub_export.py`, and OpenAPI schemas, inspected from the running container. No copied upstream application code is required.

## Machine setup and live verification (2026-11-05)

Installed OmniVoice, faster-whisper Base, and the optional sherpa Whisper Tiny model through VoiceStudio's model installer. Selected `omnivoice` for TTS and `faster-whisper` with `Systran/faster-whisper-base` for ASR. ReadAloud uses Whisper Base for both file transcription and dictation; the optional Tiny model is not required by these screens.

Whisper Base successfully transcribed a generated four-second sample in approximately 1.8 seconds. KittenTTS generation remains functional. OmniVoice synthesis returned HTTP 403 `model_licence_required` for `k2-fsa/OmniVoice` and `eustlb/higgs-audio-v2-tokenizer`; those terms were not accepted on the user's behalf. Studio shows the backend's disclosures and fingerprint-bound acceptance controls. Live cloning/design synthesis and final dubbed output remain unverified until the user accepts the required terms. Live clone and design profile creation, video upload, background separation, and video transcription also passed. Temporary verification profiles were removed. Gallery recipes and profile creation work without rendering.

Saved-profile playback checks the active engine's cloning capability and identity before requesting speech, preventing silent KittenTTS substitution. Engine changes require refreshing Voices, keeping the engine-specific audio cache consistent. The existing browser fallback remains explicit through a notification. Long CPU operations have a 30-minute proxy timeout.

## Verification

`pnpm typecheck`, `pnpm test`, and Playwright workflow tests in `apps/web/tests/e2e/studio.spec.ts`. Mocked tests cover request payloads, script editing, task completion/error handling, persistence, microphone cleanup, license gating, and mobile accessibility. Unit tests cover chunked SSE parsing, interrupted tasks, transcription forms, and subtitle timestamps. Mocked rendering tests do not establish real model audio quality.

## Preview latency follow-up (2026-11-05)

After the user accepted both model terms, the first Librarian preview took roughly 86 seconds from model loading to audio delivery on this CPU; model loading itself took about three seconds. Completed Librarian and Documentarian previews subsequently returned in 23–30 ms. VoiceStudio's optional downloadable preview gallery returned HTTP 404, so it was restored to its original disabled state.

Gallery playback now fetches preview-source status and the complete audio before mounting the player. It shows generation/loading status and elapsed time, surfaces structured server errors, and offers retry after a three-minute wait. Closing or switching previews aborts the browser request and releases the audio URL; VoiceStudio may continue its shared render and cache it. A bounded in-memory cache reuses the last 12 completed clips. This fixes the indefinite native-player spinner and repeated downloads; it does not accelerate first-time CPU inference. Actual gallery synthesis is now verified; a complete real dubbed-video render has not yet been verified.
