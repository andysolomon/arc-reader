import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { publicAccess } from "../web/vite.gate";
import { mounted, practiceApi } from "./vite.server";

export default defineConfig(({ mode }) => {
  // Server-side only (no VITE_ prefix): never reaches the bundle.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env } as Record<string, string>;
  // ReadAloud's web server. On this machine that is the deployed app's local port.
  const proxy = practiceApi(env.CADENCE_API_URL || "http://127.0.0.1:4179");
  return {
    // Relative, so one build works at the tailnet address's root and under /cadence/ (vite.server.ts).
    base: "./",
    plugins: [
      mounted(),
      // The same token as ReadAloud: on one address, its cookie opens both.
      publicAccess(env, { app: "Cadence", message: "This Cadence is private. Open it with your access link.", relativeRedirect: true }),
      react(),
    ],
    server: { port: 5183, strictPort: true, allowedHosts: [".ts.net"], proxy },
    preview: { port: 4183, strictPort: true, allowedHosts: [".ts.net"], proxy },
  };
});
