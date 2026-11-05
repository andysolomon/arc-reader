import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

/** LIVE=1 runs the suite against a real VoiceStudio at VOICESTUDIO_URL (key from VOICESTUDIO_API_KEY or apps/web/.env.local). */
const LIVE = process.env.LIVE === "1";
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
    baseURL: "http://127.0.0.1:4173",
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
            command: "node tests/stub-voicestudio.mjs 3999 test-key",
            url: "http://127.0.0.1:3999/health",
            reuseExistingServer: !process.env.CI,
            timeout: 20_000,
          },
          {
            command: "node tests/stub-voicestudio.mjs 3998 oa-test-key",
            url: "http://127.0.0.1:3998/health",
            reuseExistingServer: !process.env.CI,
            timeout: 20_000,
          },
        ]),
    {
      // Built against the proxy; the preview server forwards /api/vs to the stub above.
      command: "pnpm build && pnpm preview",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        VITE_API_BASE: "/api/vs",
        VITE_TTS_PROVIDER: "openai",
        VITE_DEFAULT_ENGINE: "kittentts",
        VOICESTUDIO_URL: LIVE ? process.env.VOICESTUDIO_URL || localEnv.VOICESTUDIO_URL || "http://127.0.0.1:3900" : "http://127.0.0.1:3999",
        VOICESTUDIO_API_KEY: LIVE ? process.env.VOICESTUDIO_API_KEY || localEnv.VOICESTUDIO_API_KEY || "" : "test-key",
        VITE_OPENAI_BASE: "/api/oa",
        VITE_OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
        OPENAI_URL: LIVE ? process.env.OPENAI_URL || localEnv.OPENAI_URL || "https://api.openai.com" : "http://127.0.0.1:3998",
        OPENAI_API_KEY: LIVE ? process.env.OPENAI_API_KEY || localEnv.OPENAI_API_KEY || "" : "oa-test-key",
      },
    },
  ],
});
