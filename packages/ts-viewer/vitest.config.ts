import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Deliberately does NOT extend vite.config.ts: the adapter's unit tests cover
// pure .js modules, so the vue/auto-import/scss plugin chain is dead weight and
// its global auto-imports would mask missing imports in the modules under test.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,ts}"],
  },
});
