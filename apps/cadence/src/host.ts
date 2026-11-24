import { configurePractice } from "@readaloud/practice/host";
import { request } from "@readaloud/practice/request";

/** ReadAloud's API, beside this page wherever it is served: /api at the tailnet address, /cadence/api at the public one. */
const api = new URL("api", document.baseURI).pathname.replace(/\/$/, "");

/** Phonon's Easton, ReadAloud's default voice: quick to answer and clear at a learner's pace. */
const VOICE = "Easton";
const MODEL = "gradium/phonon-31m-en";

configurePractice({
  api,
  synthesize: (text, signal) => ({
    lang: "en-US",
    clip: request(`${api}/phonon/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg, audio/*" },
      body: JSON.stringify({ model: MODEL, input: text, voice: VOICE, response_format: "mp3", speed: 1 }),
      signal,
      // A piece is about 20 s of speech, which Phonon makes in a few seconds.
      timeoutMs: 60_000,
    }).then(async (response) => {
      const audio = response.ok ? await response.blob() : null;
      // No usable clip: the browser's own voice says it instead.
      return { audio: audio && audio.size > 0 && (!audio.type || audio.type.startsWith("audio/") || audio.type === "application/octet-stream") ? audio : null };
    }, (error: unknown) => {
      if (signal?.aborted) throw error;
      return { audio: null };
    }),
  }),
});
