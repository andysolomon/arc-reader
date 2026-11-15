import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 4184);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    reducedMotion: "reduce",
    // A phone by default: touch, so "Tap" rather than "Click". Desktop tests set their own size.
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } }],
  webServer: {
    command: `pnpm build && exec node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Every API call is answered by the tests; nothing should reach a real ReadAloud.
    env: { CADENCE_API_URL: "http://127.0.0.1:9", READALOUD_ACCESS_TOKEN: "e2e-access-token-e2e-access-token-0123" },
  },
});
