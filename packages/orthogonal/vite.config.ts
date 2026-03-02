import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// Configuration based on neuroglancer's official Vite example:
// https://github.com/google/neuroglancer/tree/master/examples/vite

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  esbuild: {
    // Required: neuroglancer uses decorators that need ES2022+
    target: "es2022",
  },
  worker: {
    // Required: neuroglancer workers use dynamic imports
    format: "es",
  },
  optimizeDeps: {
    // Scan neuroglancer's bundle entry points so Vite discovers and
    // pre-bundles their CJS transitive deps (codemirror, crc-32, etc.)
    // even though neuroglancer itself is excluded.
    entries: [
      "index.html",
      "node_modules/neuroglancer/lib/main.bundle.js",
      "node_modules/neuroglancer/lib/async_computation.bundle.js",
      "node_modules/neuroglancer/lib/chunk_worker.bundle.js",
    ],
    // CRITICAL: neuroglancer MUST be excluded from pre-bundling.
    // Its `new URL(..., import.meta.url)` worker pattern is incompatible
    // with esbuild's pre-bundling (rewrites import.meta.url).
    exclude: ["neuroglancer"],
  },
  build: {
    chunkSizeWarningLimit: 2 * 1024 * 1024,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Orthogonal",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [
        "vue",
        "neuroglancer",
        /^neuroglancer\/.*/,
      ],
      output: {
        exports: "named",
        globals: {
          vue: "Vue",
        },
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
      },
    },
    copyPublicDir: false,
  },
});
