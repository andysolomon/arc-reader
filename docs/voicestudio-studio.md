# ReadAloud Studio

`/studio` connects directly to the installed VoiceStudio 0.5.7 API through the existing server-side `/api/vs` proxy. API credentials stay in the ignored `apps/web/.env.local` file.

- **Clone:** upload or record a reference, optionally provide its transcript, and create a clone profile with multipart `POST /profiles`.
- **Design:** `POST /design/describe` maps descriptions onto the model's supported attributes. Unsupported words are displayed before saving the recipe with `kind=design`, `vd_states`, and a deterministic seed.
- **Gallery:** browse/search/paginate the actual `/archetypes` catalog, preview samples, and import recipes with `/archetypes/{id}/use`. Saved designs are distinguished from clones in Voices.
- **Promote and demote:** VoiceStudio tags an imported recipe's profile with `personality=archetype:<id>`, and `/profiles` returns that field. A recipe already saved this way is hidden from the gallery (the status line counts hidden cards per page) so each voice lives in one place. On Voices, such a voice has a "Send … back to Studio" control that calls `DELETE /profiles/{id}`, drops the voice, resets the global selection if it was chosen, and lets the recipe reappear in the gallery. Clones and designs made in Studio never get this control: deleting them would discard the reference recording, and nothing would come back.
- **Gallery favorites and previews:** star recipes to keep them in this browser’s searchable Favorites view, across catalog pages and reloads. Cards check `/archetypes/{id}/preview/state` without generating audio; cached or gallery clips show “Preview ready” and “Play preview”, and completed generation updates the card immediately. Cache status is rechecked on return instead of persisted as a potentially stale flag. Favorites store recipe metadata separately from imported profiles. Studio’s catalog is labeled VoiceStudio; the Voices page also labels Fish, ChatGPT, and browser voices.
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

Gallery playback now fetches preview-source status and the complete audio before mounting the player. It shows generation/loading status and elapsed time, surfaces structured server errors, and offers retry after a three-minute wait. Preview requests run outside the gallery component (`state/previews.ts`), so navigating to another page or Studio tab, closing the panel, or switching voices does not abort a render in progress; returning shows its progress, or the finished clip if the panel was still open. Finished clips nobody is viewing release their audio URL, and reopening revalidates against the server. A bounded in-memory cache reuses the last 12 completed clips. This fixes the indefinite native-player spinner and repeated downloads; it does not accelerate first-time CPU inference. Actual gallery synthesis is now verified; a complete real dubbed-video render has not yet been verified.

## Korean Narrator repair (2026-11-05)

The original `ml_korean_narrator` preview was a valid 6.895-second WAV but yielded no transcript in faster-whisper Base. The backend's silence/tonal-artifact checks had accepted it. Its recipe correctly used Korean text and language; this was a bad synthesis result, not a WAV-format mismatch.

Regenerated through `/generate` with the same script and voice instruction (`female, middle-aged, low pitch`), `language=Korean`, `engine=omnivoice`, seed **43**, and **64** steps (original preview defaults: seed 42, 32 steps). The resulting 6.31-second take (`529df5aa.wav`) was recognized as Korean with probability 1.00, no audio removed by VAD, and the full sample recovered except for `데모` transcribed as `대모`. Changing both seed and step count establishes a working recipe, but does not isolate which change resolved the failed render.

Replaced `/app/omnivoice_data/outputs/archetype_previews/327adafa22e5967d.wav` atomically in the persistent Docker data volume after validation. The original is preserved beside it as `327adafa22e5967d.failed-20261105.wav.bak`, with repair metadata in `327adafa22e5967d.repair.json`. Verified the live preview endpoint serves the exact replacement bytes. This repairs the saved preview; backend generation defaults and automatic speech-quality validation remain unchanged. If this disk cache is cleared, regenerate using the verified settings above and validate before replacing it.

Gallery playback now revalidates audio with the server on each open instead of holding completed blobs in an application cache. HTTP caching can still reuse unchanged bytes; a repaired clip is picked up without a page reload. A regression test replaces the served clip between opens and verifies the new audio duration, alongside existing timeout/error tests.

## Mac preparation tuning (2026-11-05)

The Mac mini runs VoiceStudio 0.5.7 natively on an M4 Pro with 24 GB of unified memory. `/health` reports `device=mps`, and the active OmniVoice implementation is `OmniVoiceMPSSubprocessBackend`. The model already loads on MPS in float16; its audio tokenizer runs on CPU because the model's tokenizer does not support MPS. Increasing request concurrency does not remove this bottleneck: VoiceStudio deliberately serializes MPS synthesis through one worker.

Two differences between the isolated and in-process OmniVoice implementations added work to every passage:

- The isolated worker omitted `num_step` when the API caller omitted it, falling through to the model's **32** steps. The ordinary VoiceStudio adapter uses **16**. ReadAloud now explicitly requests 16 steps for OmniVoice, and the Mac worker defaults to 16 as well. This is a synthesis quality/speed preset change, not a change in playback speed. Explicit overrides, including 32 and 64 steps, remain supported; gallery requests with explicit settings keep those settings.
- The worker reused encoded reference prompts only for references without transcripts. Saved voices with transcripts encoded their reference audio on CPU again for every passage. Those references now use the existing bounded prompt cache too, with the same invalidation and fallback behavior.

The backend fixes are applied in `~/VoiceStudio/backend/engines/omnivoice_subprocess/main.py` on the Mac mini. The isolated worker was unloaded through the busy-guarded `/model/unload/sidecar:omnivoice` endpoint, retrying when it reported busy until an idle gap; the next request loaded the patched worker. The parent service did not need restarting. This activates the backend fix for existing ReadAloud clients, independently of rebuilding the web app.

The [backend patch and regression tests](patches/voicestudio-0.5.7-mps-preparation.patch) are preserved here because upstream updates can replace local edits. Against the matching VoiceStudio 0.5.7 source:

```sh
git apply --check /path/to/voicestudio-0.5.7-mps-preparation.patch
git apply /path/to/voicestudio-0.5.7-mps-preparation.patch
PYTHONPATH=backend .venv/bin/pytest -q backend/tests/test_omnivoice_subprocess.py tests/test_clone_prompt_cache.py tests/test_omnivoice_sidecar_cold_start.py
# To undo, first check: git apply --reverse --check /path/to/voicestudio-0.5.7-mps-preparation.patch
# Then: git apply --reverse /path/to/voicestudio-0.5.7-mps-preparation.patch
```

Measured with `POST /v1/audio/speech`, `model=tts-1`, `voice=demo0001`, `seed=42`, WAV output, and the same three-sentence English passage (about 10.09 seconds of audio):

| Configuration | Observed request times |
| --- | --- |
| Original worker, 32 steps | 20.217 s, 22.043 s |
| Original worker, explicit 16 steps | 15.266 s, 16.386 s |
| Patched worker, default 16 steps, first request after reload | 10.487 s |
| Patched worker, default 16 steps, warm reference cache | 6.168 s, 6.868 s |

Warm requests averaged 6.518 seconds versus 21.130 seconds before the fixes, about **3.2×** the throughput for this sample. These are small-sample wall-clock measurements on a shared server while reading preparation was active; they include any queue wait and are not an isolated model benchmark. Designed voices without an audio reference benefit from the step default but not reference caching. Existing prepared browser clips are retained. The patched and original 16-step WAVs were byte-for-byte identical for this seed and sample, establishing that reference reuse preserved output. The 16-step preset can produce different audio from 32 steps.

Validation: 71 backend tests and 119 ReadAloud tests passed, along with type checking and the production build. Provider tests verify the 16-step request for OmniVoice and that other providers do not receive the extension. The installed local faster-whisper recognizer recovered the complete sample transcript without word errors. The Mac's selected MLX Whisper model was not installed, so that check used the existing CPU speech server on Omarchy without changing the Mac's ASR settings.
