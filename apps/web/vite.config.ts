import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { tailnetUrl } from "./vite.tailnet";
import { voiceStudioProxy } from "./vite.proxy";
import { pageFetch } from "./vite.fetch";
import { audioPreparation } from "./vite.prepare";
import { sharedLibrary } from "./vite.library";
import { SpeechActivity } from "./vite.speech-activity";

export default defineConfig(({ mode }) => {
  // Server-side only (no VITE_ prefix): never reaches the bundle.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env } as Record<string, string>;
  // Live speech through the proxy pauses background preparation on the same VoiceStudio.
  const activity = new SpeechActivity(Number(env.PREPARATION_YIELD_MS) || undefined);
  const proxy = voiceStudioProxy(env, activity);
  return {
  plugins: [
    react(),
    tailnetUrl(),
    pageFetch(),
    audioPreparation(env, activity),
    sharedLibrary(env),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.svg", "icons/*.png", "splash.svg"],
      manifest: {
        name: "ReadAloud",
        short_name: "ReadAloud",
        description: "Paste anything. Hear it read.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#161412",
        theme_color: "#161412",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
        screenshots: [{ src: "/splash.svg", sizes: "1200x2400", type: "image/svg+xml", form_factor: "narrow" }],
        share_target: {
          action: "/read/new",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
        shortcuts: [
          { name: "Compose", url: "/", description: "Paste something to listen to" },
          { name: "Library", url: "/library" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: "127.0.0.1", port: 5181, strictPort: true, allowedHosts: [".ts.net"], proxy },
  preview: { host: "127.0.0.1", port: 4173, allowedHosts: [".ts.net"], proxy },
  build: { target: "es2022", sourcemap: false },
  };
});
