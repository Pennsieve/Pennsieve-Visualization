import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// App-mode build for the embeddable orthogonal viewer.
// Produces a self-contained static app (HTML + JS/CSS/workers/WASM)
// deployable to S3/CloudFront and loaded inside an iframe.

export default defineConfig({
  plugins: [vue()],
  root: __dirname,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  esbuild: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    entries: [
      "embed.html",
      "node_modules/neuroglancer/lib/main.bundle.js",
      "node_modules/neuroglancer/lib/async_computation.bundle.js",
      "node_modules/neuroglancer/lib/chunk_worker.bundle.js",
    ],
    exclude: ["neuroglancer"],
  },
  build: {
    outDir: resolve(__dirname, "dist-embed"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2 * 1024 * 1024,
    rollupOptions: {
      input: resolve(__dirname, "embed.html"),
    },
  },
});
