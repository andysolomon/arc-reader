import { defineConfig, devices } from "@playwright/test";

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
  webServer: [
    {
      command: "node tests/stub-voicestudio.mjs 3999 test-key",
      url: "http://127.0.0.1:3999/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
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
        VOICESTUDIO_URL: "http://127.0.0.1:3999",
        VOICESTUDIO_API_KEY: "test-key",
      },
    },
  ],
});
