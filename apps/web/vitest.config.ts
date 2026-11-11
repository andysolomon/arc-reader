import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts", "vite.*.test.ts", "scripts/*.test.ts"], environment: "node", env: { VITE_API_BASE: "/api/vs", VITE_OPENAI_BASE: "/api/oa", VITE_FISH_BASE: "/api/fish", VITE_FISH_TTS_MODEL: "s2.1-pro" } } });
