import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** LIVE=1 runs the suite against a real VoiceStudio at VOICESTUDIO_URL (key from VOICESTUDIO_API_KEY or apps/web/.env.local). */
const LIVE = process.env.LIVE === "1";
const webPort = Number(process.env.E2E_PORT || 4173);
const voicePort = Number(process.env.E2E_VOICE_PORT || 3999);
const openaiPort = Number(process.env.E2E_OPENAI_PORT || 3998);
const localEnv = (() => {
  try {
    return Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => l.split(/=(.*)/s).slice(0, 2)));
  } catch {
    return {} as Record<string, string>;
  }
})();

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  grep: LIVE ? /@live/ : undefined,
  grepInvert: LIVE ? undefined : /@live/,
  webServer: [
    ...(LIVE
      ? []
      : [
          {
            command: `node tests/stub-voicestudio.mjs ${voicePort} test-key`,
            url: `http://127.0.0.1:${voicePort}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 20_000,
          },
          {
            command: `node tests/stub-voicestudio.mjs ${openaiPort} oa-test-key`,
            url: `http://127.0.0.1:${openaiPort}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 20_000,
          },
        ]),
    {
      // Built against the proxy; the preview server forwards /api/vs to the stub above.
      command: `pnpm build && exec node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        VITE_API_BASE: "/api/vs",
        VITE_TTS_PROVIDER: "openai",
        VITE_DEFAULT_ENGINE: "kittentts",
        VOICESTUDIO_URL: LIVE ? process.env.VOICESTUDIO_URL || localEnv.VOICESTUDIO_URL || "http://127.0.0.1:3900" : `http://127.0.0.1:${voicePort}`,
        VOICESTUDIO_API_KEY: LIVE ? process.env.VOICESTUDIO_API_KEY || localEnv.VOICESTUDIO_API_KEY || "" : "test-key",
        VOICESTUDIO_NAME: "Mac",
        // Stub workflows exercise one machine unless a test explicitly adds a second.
        VOICESTUDIO_SECONDARY_URL: LIVE ? process.env.VOICESTUDIO_SECONDARY_URL || localEnv.VOICESTUDIO_SECONDARY_URL || "" : "",
        VITE_OPENAI_BASE: "/api/oa",
        VITE_OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
        OPENAI_URL: LIVE ? process.env.OPENAI_URL || localEnv.OPENAI_URL || "https://api.openai.com" : `http://127.0.0.1:${openaiPort}`,
        OPENAI_API_KEY: LIVE ? process.env.OPENAI_API_KEY || localEnv.OPENAI_API_KEY || "" : "oa-test-key",
        // Local credentials must not enable a real provider in the stub suite.
        VITE_FISH_BASE: LIVE ? process.env.VITE_FISH_BASE || localEnv.VITE_FISH_BASE || "" : "",
        FISH_API_KEY: LIVE ? process.env.FISH_API_KEY || localEnv.FISH_API_KEY || "" : "",
        LIBRARY_DATA_DIR: join(tmpdir(), `readaloud-e2e-library-${process.pid}`),
      },
    },
  ],
});
