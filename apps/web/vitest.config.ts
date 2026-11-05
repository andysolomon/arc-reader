import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node", env: { VITE_API_BASE: "/api/vs", VITE_OPENAI_BASE: "/api/oa" } } });
