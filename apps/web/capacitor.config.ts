import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS shell around the Vite production build. `webDir` is the production
 * bundle, and `server.url` is intentionally unset so the web view loads those
 * files from the app. It does not load a remote page at startup.
 *
 * Absolute speech-server requests (Settings → Speech server) go through the
 * native HTTP stack so a tailnet VoiceStudio does not need CORS headers.
 */
const config: CapacitorConfig = {
  appId: "dev.andrewsolomon.arcreader",
  appName: "ReadAloud",
  webDir: "dist",
  // Shown behind the web view until the first paint. Matches the dark theme.
  backgroundColor: "#161412",
  ios: {
    backgroundColor: "#161412",
    // The shell pads itself with env(safe-area-inset-*). Automatic insets
    // would pad twice and sit the reader below the status bar.
    contentInset: "never",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    StatusBar: {
      overlaysWebView: true,
      // Light status-bar text on the dark background. Theme changes flip this
      // at runtime (see App.tsx).
      style: "DARK",
      backgroundColor: "#161412",
    },
  },
};

export default config;
